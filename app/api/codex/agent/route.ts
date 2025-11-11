import path from 'node:path'

import { NextRequest } from 'next/server'

import { error, methodNotAllowed } from '@/lib/server/http'
import { logError, logInfo } from '@/lib/server/logger'
import { startWorkspaceThread } from '@/lib/server/codex'
import { createSnapshot, dropSnapshot, getSnapshotSummary } from '@/lib/server/git'

import type {
  ThreadEvent,
  ThreadItem,
  ItemStartedEvent,
  ItemUpdatedEvent,
  ItemCompletedEvent,
  Input,
} from '@openai/codex-sdk'

export const runtime = 'nodejs'

type RunPayload = {
  prompt: string
  images?: string[]
}

const encoder = new TextEncoder()
const WORKSPACE_ROOT = process.cwd()

type StreamEmitter = {
  send: (event: string, data: unknown) => void
  close: () => void
  isClosed: () => boolean
}

function createEmitter(controller: ReadableStreamDefaultController<Uint8Array>): StreamEmitter {
  let closed = false

  return {
    send(event, data) {
      if (closed) return
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      } catch (err) {
        closed = true
        console.warn('[codex] Failed to stream event', { event, error: err instanceof Error ? err.message : err })
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        controller.close()
      } catch (err) {
        console.warn('[codex] Failed to close stream controller', err)
      }
    },
    isClosed() {
      return closed
    },
  }
}

function handleItemEvent(emitter: StreamEmitter, phase: 'started' | 'updated' | 'completed', item: ThreadItem) {
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

function forwardEvent(emitter: StreamEmitter, event: ThreadEvent) {
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
      handleItemEvent(emitter, 'started', (event as ItemStartedEvent).item)
      break
    case 'item.updated':
      handleItemEvent(emitter, 'updated', (event as ItemUpdatedEvent).item)
      break
    case 'item.completed':
      handleItemEvent(emitter, 'completed', (event as ItemCompletedEvent).item)
      break
    case 'error':
      emitter.send('message', {
        type: 'error',
        text: event.message,
      })
      break
  }
}

function parsePayload(body: unknown): RunPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be an object')
  }
  const record = body as Record<string, unknown>
  const rawPrompt = record.prompt
  if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
    throw new Error('Prompt is required')
  }

  const prompt = rawPrompt.trim()
  const rawImages = record.images
  let images: string[] | undefined
  if (Array.isArray(rawImages)) {
    const entries = rawImages
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
    if (entries.length > 0) {
      images = entries
    }
  }

  return images ? { prompt, images } : { prompt }
}

function createThreadInput(prompt: string, images: string[]): Input {
  if (!images.length) {
    return prompt
  }

  const items = [
    { type: 'text' as const, text: prompt },
    ...images.map((imagePath) => ({
      type: 'local_image' as const,
      path: resolveImagePath(imagePath),
    })),
  ]

  return items
}

function resolveImagePath(imagePath: string) {
  const normalized = imagePath.trim()
  if (!normalized) return WORKSPACE_ROOT
  const absolute = path.isAbsolute(normalized) ? normalized : path.join(WORKSPACE_ROOT, normalized)
  return path.normalize(absolute)
}

export async function POST(request: NextRequest) {
  try {
    const payload = parsePayload(await request.json())
    const preRunSnapshot = await createSnapshot('agent-run-pre')
    let postRunSnapshot: string | null = null
    const thread = startWorkspaceThread()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emitter = createEmitter(controller)

        const abortHandler = () => {
          emitter.close()
        }
        request.signal.addEventListener('abort', abortHandler)

        let hasFileChanges = false
        let finalResponse: string | null = null

        try {
          const input = createThreadInput(payload.prompt, payload.images ?? [])
          const { events } = await thread.runStreamed(input)
          for await (const event of events) {
            if (emitter.isClosed()) break
            if (
              (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') &&
              ((event as ItemStartedEvent | ItemUpdatedEvent | ItemCompletedEvent).item.type === 'file_change')
            ) {
              hasFileChanges = true
            }
            if (event.type === 'item.completed') {
              const item = (event as ItemCompletedEvent).item
              if (item.type === 'agent_message') {
                finalResponse = item.text
              }
            }
            forwardEvent(emitter, event)
          }
          if (!emitter.isClosed()) {
            if (!hasFileChanges && preRunSnapshot) {
              await dropSnapshot(preRunSnapshot)
            }
            if (hasFileChanges) {
              postRunSnapshot = await createSnapshot('agent-run-post')
            }
            const summary = await getSnapshotSummary()
            if (finalResponse) {
              emitter.send('message', {
                type: 'agent.final',
                text: finalResponse,
                payload: { finalResponse },
              })
            }
            emitter.send('done', {
              ok: true,
              hasSnapshots: summary.hasSnapshots,
              snapshotCreated: Boolean(postRunSnapshot),
              preSnapshotRetained: Boolean(preRunSnapshot && hasFileChanges),
              ...(finalResponse ? { finalResponse } : {}),
            })
          }
        } catch (streamError) {
          logError('Codex streaming failed', streamError)
          if (!emitter.isClosed()) {
            emitter.send('message', {
              type: 'error',
              text:
                streamError instanceof Error
                  ? streamError.message
                  : 'Unknown Codex streaming failure',
              payload:
                streamError instanceof Error
                  ? { name: streamError.name, stack: streamError.stack }
                  : undefined,
            })
            if (!hasFileChanges && preRunSnapshot) {
              await dropSnapshot(preRunSnapshot)
            }
            if (hasFileChanges) {
              postRunSnapshot = await createSnapshot('agent-run-post')
            }
            const summary = await getSnapshotSummary()
            if (finalResponse) {
              emitter.send('message', {
                type: 'agent.final',
                text: finalResponse,
                payload: { finalResponse },
              })
            }
            emitter.send('done', {
              ok: false,
              error: streamError instanceof Error ? streamError.message : 'Codex streaming failed',
              hasSnapshots: summary.hasSnapshots,
              snapshotCreated: Boolean(postRunSnapshot),
              preSnapshotRetained: Boolean(preRunSnapshot && hasFileChanges),
              ...(finalResponse ? { finalResponse } : {}),
            })
          }
        } finally {
          emitter.close()
          request.signal.removeEventListener('abort', abortHandler)
        }
      },
    })

    logInfo('Codex agent run dispatched', {
      preRunSnapshotSaved: Boolean(preRunSnapshot),
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    logError('Failed to handle Codex request', err)
    return error(400, err instanceof Error ? err.message : 'Invalid Codex payload')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
