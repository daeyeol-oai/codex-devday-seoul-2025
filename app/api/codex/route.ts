import { NextRequest } from 'next/server'

import { error, methodNotAllowed } from '@/lib/server/http'
import { logError, logInfo } from '@/lib/server/logger'
import { ensureOpenAIConfigured } from '@/lib/server/openai'

export const runtime = 'nodejs'

type RunActionPayload = {
  action: 'run'
  prompt: string
}

type ThemeActionPayload = {
  action: 'theme'
  theme: {
    primary: string
    accent: string
  }
}

type UndoActionPayload = {
  action: 'undo'
}

type CodexActionPayload = RunActionPayload | ThemeActionPayload | UndoActionPayload

const encoder = new TextEncoder()

function formatEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(encoder.encode(formatEvent(event, data)))
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function handleRunAction(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: RunActionPayload,
  signal: AbortSignal,
) {
  const threadId = `mock-thread-${Date.now().toString(36)}`
  send(controller, 'thread.started', { threadId, prompt: payload.prompt })

  if (signal.aborted) return
  await delay(120)
  send(controller, 'plan.created', {
    items: [
      { id: `${threadId}-step-1`, title: 'Inspect project context', status: 'completed' },
      { id: `${threadId}-step-2`, title: 'Propose implementation approach', status: 'in_progress' },
      { id: `${threadId}-step-3`, title: 'Outline next actions', status: 'pending' },
    ],
  })

  if (signal.aborted) return
  await delay(120)
  send(controller, 'command.started', {
    id: `${threadId}-cmd-1`,
    command: 'npm run lint',
  })

  if (signal.aborted) return
  await delay(160)
  send(controller, 'command.completed', {
    id: `${threadId}-cmd-1`,
    command: 'npm run lint',
    exitCode: 0,
    output: 'Lint checks passed (mocked).',
  })

  if (signal.aborted) return
  await delay(160)
  send(controller, 'file.change', {
    id: `${threadId}-patch-1`,
    changes: [
      {
        path: 'app/api/images/route.ts',
        kind: 'update',
      },
      {
        path: 'app/api/videos/route.ts',
        kind: 'update',
      },
    ],
    status: 'completed',
  })

  if (signal.aborted) return
  await delay(160)
  send(controller, 'message', {
    text: 'Mock Codex agent: Generated backend API scaffolding and placeholder assets.',
  })

  if (signal.aborted) return
  await delay(80)
  send(controller, 'turn.completed', {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
  })

  send(controller, 'thread.completed', {
    threadId,
    status: 'success',
  })
}

async function handleThemeAction(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: ThemeActionPayload,
) {
  send(controller, 'theme.applied', {
    theme: payload.theme,
    note: 'Theme update is mocked; no files were modified.',
  })
}

async function handleUndoAction(
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  send(controller, 'undo.completed', {
    restored: true,
    message: 'Undo applied using mock snapshot.',
  })
}

function validatePayload(payload: unknown): CodexActionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object')
  }

  const action = (payload as { action?: unknown }).action
  if (action === 'run') {
    const prompt = (payload as RunActionPayload).prompt
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('Prompt is required for run action')
    }
    return { action: 'run', prompt }
  }

  if (action === 'theme') {
    const theme = (payload as ThemeActionPayload).theme
    if (
      !theme ||
      typeof theme.primary !== 'string' ||
      typeof theme.accent !== 'string'
    ) {
      throw new Error('Theme action requires primary and accent colors')
    }
    return { action: 'theme', theme }
  }

  if (action === 'undo') {
    return { action: 'undo' }
  }

  throw new Error('Unsupported Codex action')
}

export async function POST(request: NextRequest) {
  try {
    ensureOpenAIConfigured()
    const payload = validatePayload(await request.json())

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const abortHandler = () => {
          controller.close()
        }
        request.signal.addEventListener('abort', abortHandler)

        try {
          if (payload.action === 'run') {
            await handleRunAction(controller, payload, request.signal)
          } else if (payload.action === 'theme') {
            await handleThemeAction(controller, payload)
          } else if (payload.action === 'undo') {
            await handleUndoAction(controller)
          }
        } catch (streamError) {
          logError('Codex stream failed', streamError)
          send(controller, 'error', {
            message:
              streamError instanceof Error
                ? streamError.message
                : 'Unknown Codex streaming failure',
          })
        } finally {
          controller.close()
          request.signal.removeEventListener('abort', abortHandler)
        }
      },
    })

    logInfo('Codex action dispatched', { action: payload.action })

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
    return error(
      400,
      err instanceof Error ? err.message : 'Invalid Codex payload',
    )
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
