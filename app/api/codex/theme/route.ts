import { promises as fs } from 'fs'
import { NextRequest } from 'next/server'

import { startWorkspaceThread } from '@/lib/server/codex'
import { error, methodNotAllowed } from '@/lib/server/http'
import { resolveWorkspacePath } from '@/lib/server/fs-apply'
import { createSnapshot, getSnapshotSummary } from '@/lib/server/git'
import { logError, logInfo } from '@/lib/server/logger'

import type {
  ItemCompletedEvent,
  ItemStartedEvent,
  ItemUpdatedEvent,
  ThreadEvent,
  ThreadItem,
} from '@openai/codex-sdk'

export const runtime = 'nodejs'

type ThemePayload = {
  primary: string
  accent: string
}

const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const THEME_FILE = 'styles/theme.css'
const encoder = new TextEncoder()

function validateTheme(payload: unknown): ThemePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Theme payload must be an object')
  }

  const { primary, accent } = payload as ThemePayload
  if (typeof primary !== 'string' || !COLOR_REGEX.test(primary)) {
    throw new Error('primary must be a valid hex color (e.g., #2563eb)')
  }
  if (typeof accent !== 'string' || !COLOR_REGEX.test(accent)) {
    throw new Error('accent must be a valid hex color (e.g., #38bdf8)')
  }

  return { primary: primary.toLowerCase(), accent: accent.toLowerCase() }
}

function buildPrompt({ primary, accent }: ThemePayload) {
  return [
    'Update the CSS variables that control the Builder side panel accent colours.',
    `File path: ${THEME_FILE}`,
    '',
    'Requirements:',
    `- Set \`--accent-primary\` to \`${primary}\`.`,
    `- Set \`--accent-secondary\` to \`${accent}\`.`,
    '- Apply the values in all places those tokens appear (light and dark theme sections).',
    '- Do not modify unrelated CSS tokens or formatting beyond the value replacements.',
    '- Ensure the file remains valid CSS.',
  ].join('\n')
}

function createEmitter(controller: ReadableStreamDefaultController<Uint8Array>) {
  let closed = false

  return {
    send(event: string, data: unknown) {
      if (closed) return
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    },
    close() {
      if (closed) return
      closed = true
      try {
        controller.close()
      } catch (err) {
        console.warn('[codex] Failed to close theme stream', err)
      }
    },
    isClosed() {
      return closed
    },
  }
}

function handleItem(emitter: ReturnType<typeof createEmitter>, phase: 'started' | 'updated' | 'completed', item: ThreadItem) {
  switch (item.type) {
    case 'todo_list':
      emitter.send('message', {
        type: 'plan.updated',
        text: `Plan ${phase}`,
        payload: { phase, items: item.items },
      })
      break
    case 'command_execution':
      emitter.send('message', {
        type: `command.${phase}`,
        text: `${item.command} (${item.status})`,
        payload: {
          id: item.id,
          command: item.command,
          status: item.status,
          exitCode: item.exit_code,
          output: item.aggregated_output,
        },
      })
      break
    case 'file_change':
      emitter.send('message', {
        type: 'file.change',
        text: `File change ${item.status}`,
        payload: {
          id: item.id,
          status: item.status,
          changes: item.changes,
        },
      })
      break
    case 'agent_message':
      emitter.send('message', {
        type: 'agent.message',
        text: item.text,
        payload: { id: item.id },
      })
      break
    case 'reasoning':
      emitter.send('message', {
        type: 'reasoning',
        text: item.text,
        payload: { id: item.id },
      })
      break
    case 'error':
      emitter.send('message', {
        type: 'error.item',
        text: item.message,
        payload: { id: item.id },
      })
      break
    case 'mcp_tool_call':
      emitter.send('message', {
        type: `tool.${phase}`,
        text: `${item.server}.${item.tool} (${item.status})`,
        payload: {
          id: item.id,
          server: item.server,
          tool: item.tool,
          status: item.status,
        },
      })
      break
    case 'web_search':
      emitter.send('message', {
        type: `search.${phase}`,
        text: `Search: ${item.query}`,
        payload: {
          id: item.id,
          query: item.query,
        },
      })
      break
    default:
      emitter.send('message', {
        type: `item.${phase}`,
        payload: item,
      })
  }
}

function forwardEvent(emitter: ReturnType<typeof createEmitter>, event: ThreadEvent) {
  switch (event.type) {
    case 'thread.started':
      emitter.send('message', {
        type: 'thread.started',
        text: 'Thread started',
        payload: { threadId: event.thread_id },
      })
      break
    case 'turn.started':
      emitter.send('message', { type: 'turn.started', text: 'Turn started' })
      break
    case 'turn.completed':
      emitter.send('message', {
        type: 'turn.completed',
        text: 'Turn completed',
        payload: { usage: event.usage },
      })
      break
    case 'turn.failed':
      emitter.send('message', {
        type: 'turn.failed',
        text: event.error.message,
        payload: { error: event.error },
      })
      break
    case 'item.started':
      handleItem(emitter, 'started', (event as ItemStartedEvent).item)
      break
    case 'item.updated':
      handleItem(emitter, 'updated', (event as ItemUpdatedEvent).item)
      break
    case 'item.completed':
      handleItem(emitter, 'completed', (event as ItemCompletedEvent).item)
      break
    case 'error':
      emitter.send('message', {
        type: 'error',
        text: event.message,
      })
      break
  }
}

function updateToken(source: string, token: string, value: string) {
  const pattern = new RegExp(`(${token}\\s*:\\s*)([^;]+)(;)`)
  if (!pattern.test(source)) {
    throw new Error(`Token ${token} not found in theme file`)
  }
  return source.replace(pattern, `$1${value}$3`)
}

async function createNoopStream(theme: ThemePayload) {
  const summary = await getSnapshotSummary()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emitter = createEmitter(controller)
      emitter.send('message', {
        type: 'theme.completed',
        text: 'Theme already matches requested colours.',
        payload: {
          hasSnapshots: summary.hasSnapshots,
          theme,
          reason: 'no_changes',
        },
      })
      emitter.send('done', {
        ok: true,
        hasSnapshots: summary.hasSnapshots,
        reason: 'no_changes',
      })
      emitter.close()
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const payload = validateTheme(await request.json())
    const themePath = resolveWorkspacePath(THEME_FILE)

    const content = await fs.readFile(themePath, 'utf8')
    const patched = updateToken(updateToken(content, '--accent-primary', payload.primary), '--accent-secondary', payload.accent)

    if (content === patched) {
      const stream = await createNoopStream(payload)
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const prompt = buildPrompt(payload)
    const thread = startWorkspaceThread()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitter = createEmitter(controller)

        const abortHandler = () => {
          emitter.send('done', {
            ok: false,
            error: 'Theme update aborted',
            reason: 'aborted',
          })
          emitter.close()
        }
        request.signal.addEventListener('abort', abortHandler)

        ;(async () => {
          try {
            const { events } = await thread.runStreamed(prompt)
            for await (const event of events) {
              if (emitter.isClosed()) break
              forwardEvent(emitter, event)
            }

            const snapshot = await createSnapshot('theme-update')
            const summary = await getSnapshotSummary()

            emitter.send('message', {
              type: 'theme.completed',
              text: 'Theme updated successfully.',
              payload: {
                snapshotCreated: Boolean(snapshot),
                hasSnapshots: summary.hasSnapshots,
                theme: payload,
              },
            })
            emitter.send('done', {
              ok: true,
              snapshotCreated: Boolean(snapshot),
              hasSnapshots: summary.hasSnapshots,
            })
          } catch (runError) {
            logError('Codex theme update failed', runError, { theme: payload })
            emitter.send('message', {
              type: 'error',
              text: runError instanceof Error ? runError.message : 'Codex theme update failed',
            })
            emitter.send('done', {
              ok: false,
              error: runError instanceof Error ? runError.message : 'Codex theme update failed',
            })
          } finally {
            emitter.close()
            request.signal.removeEventListener('abort', abortHandler)
          }
        })()
      },
    })

    logInfo('Starting Codex theme update', { theme: payload })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    logError('Failed to initiate Codex theme update', err)
    return error(400, err instanceof Error ? err.message : 'Failed to apply theme with Codex')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
