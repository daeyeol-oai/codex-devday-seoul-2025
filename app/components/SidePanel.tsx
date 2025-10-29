'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type PlanItem = {
  id: string
  text: string
  completed: boolean
}

type CommandItem = {
  id: string
  command: string
  status: string
  exitCode?: number
  output?: string
}

type FileChangeItem = {
  id: string
  status: string
  changes: Array<{ path: string; kind: string }>
}

type MessageItem = {
  id: string
  text: string
  tone: 'assistant' | 'reasoning' | 'error'
}

type Usage = {
  inputTokens: number
  outputTokens: number
}

const DEFAULT_PRIMARY = '#2563eb'
const DEFAULT_ACCENT = '#38bdf8'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function parseSseChunk(buffer: string, emit: (event: string, data: unknown) => void) {
  let remaining = buffer
  let boundary = remaining.indexOf('\n\n')
  while (boundary !== -1) {
    const chunk = remaining.slice(0, boundary).trim()
    remaining = remaining.slice(boundary + 2)
    if (chunk.length > 0) {
      const lines = chunk.split('\n')
      let eventName = 'message'
      const dataLines: string[] = []
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }
      if (dataLines.length > 0) {
        const payload = dataLines.join('')
        try {
          const parsed = JSON.parse(payload)
          emit(eventName, parsed)
        } catch (err) {
          console.warn('Failed to parse SSE payload', payload, err)
        }
      }
    }
    boundary = remaining.indexOf('\n\n')
  }
  return remaining
}

export default function SidePanel() {
  const [prompt, setPrompt] = useState('Summarise recent changes and propose the next UI enhancement.')
  const [isRunning, setIsRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [planItems, setPlanItems] = useState<PlanItem[]>([])
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [files, setFiles] = useState<FileChangeItem[]>([])
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [snapshotAvailable, setSnapshotAvailable] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)

  const [primary, setPrimary] = useState(DEFAULT_PRIMARY)
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [themeMessage, setThemeMessage] = useState<string | null>(null)
  const [undoMessage, setUndoMessage] = useState<string | null>(null)

  const resetState = useCallback(() => {
    setPlanItems([])
    setCommands([])
    setFiles([])
    setMessages([])
    setUsage(null)
    setErrorMessage(null)
    setSnapshotAvailable(false)
  }, [])

  const handleEvent = useCallback((event: string, payload: unknown) => {
    switch (event) {
      case 'snapshot.recorded':
        setSnapshotAvailable(true)
        break
      case 'plan.updated': {
        const record = asRecord(payload)
        const rawItems = record && Array.isArray(record.items) ? (record.items as Array<Record<string, unknown>>) : []
        const items: PlanItem[] = rawItems.map((item, index) => ({
          id: `${index}`,
          text: asString(item.text) ?? `Step ${index + 1}`,
          completed: Boolean(item.completed),
        }))
        setPlanItems(items)
        break
      }
      case 'command.started':
      case 'command.updated':
      case 'command.completed': {
        const record = asRecord(payload)
        if (!record) break
        setCommands((prev) => {
          const next = [...prev]
          const id = asString(record.id) ?? `${next.length}`
          const index = next.findIndex((item) => item.id === id)
          const entry: CommandItem = {
            id,
            command: asString(record.command) ?? next[index]?.command ?? 'command',
            status: asString(record.status) ?? next[index]?.status ?? 'in_progress',
            exitCode: asNumber(record.exitCode),
            output: asString(record.output) ?? next[index]?.output,
          }
          if (index >= 0) {
            next[index] = { ...next[index], ...entry }
          } else {
            next.push(entry)
          }
          return next
        })
        break
      }
      case 'file.change':
        setFiles((prev) => {
          const record = asRecord(payload)
          if (!record) return prev
          const changes = Array.isArray(record.changes) ? (record.changes as Array<{ path: string; kind: string }>) : []
          return [
            ...prev,
            {
              id: asString(record.id) ?? `${prev.length}`,
              status: asString(record.status) ?? 'completed',
              changes,
            },
          ]
        })
        break
      case 'message':
        setMessages((prev) => {
          const record = asRecord(payload)
          return [
            ...prev,
            {
              id: record && asString(record.id) ? (record.id as string) : `${prev.length}`,
              text: record && asString(record.text) ? (record.text as string) : '',
              tone: 'assistant',
            },
          ]
        })
        break
      case 'reasoning':
        setMessages((prev) => {
          const record = asRecord(payload)
          return [
            ...prev,
            {
              id: record && asString(record.id) ? (record.id as string) : `reasoning-${prev.length}`,
              text: record && asString(record.text) ? (record.text as string) : '',
              tone: 'reasoning',
            },
          ]
        })
        break
      case 'error':
      case 'error.item':
        setMessages((prev) => {
          const record = asRecord(payload)
          const message = record ? asString(record.message) : undefined
          setErrorMessage(message ?? 'Codex run failed')
          return [
            ...prev,
            {
              id: `error-${prev.length}`,
              text: message ?? 'Codex run failed',
              tone: 'error',
            },
          ]
        })
        break
      case 'turn.completed':
        {
          const record = asRecord(payload)
          const usageRecord = record && asRecord(record.usage)
          if (usageRecord) {
            setUsage({
              inputTokens: asNumber(usageRecord.input_tokens) ?? 0,
              outputTokens: asNumber(usageRecord.output_tokens) ?? 0,
            })
          }
        }
        break
      case 'turn.failed':
        setErrorMessage(asString(asRecord(payload)?.message) ?? 'Codex run failed')
        break
      case 'done':
        setIsRunning(false)
        break
      default:
        break
    }
  }, [])

  const runAgent = useCallback(async () => {
    if (!prompt.trim()) {
      setErrorMessage('Enter instructions before running Codex.')
      return
    }

    if (controllerRef.current) {
      controllerRef.current.abort()
    }

    resetState()
    setIsRunning(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const response = await fetch('/api/codex/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = await response.text()
        throw new Error(message || 'Failed to start Codex run')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = parseSseChunk(buffer, handleEvent)
      }

      if (buffer.length > 0) {
        parseSseChunk(buffer, handleEvent)
      }

      setIsRunning(false)
    } catch (err) {
      if (controller.signal.aborted) {
        setErrorMessage('Codex run cancelled')
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Codex run failed')
      }
      setIsRunning(false)
    } finally {
      controllerRef.current = null
    }
  }, [prompt, handleEvent, resetState])

  const cancelRun = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const applyTheme = useCallback(async () => {
    setThemeMessage('Applying theme…')
    try {
      const response = await fetch('/api/codex/theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ primary, accent }),
      })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to apply theme')
      }
      setThemeMessage('Theme updated via Codex snapshot.')
    } catch (err) {
      setThemeMessage(err instanceof Error ? err.message : 'Failed to apply theme')
    }
  }, [primary, accent])

  const undoSnapshot = useCallback(async () => {
    setUndoMessage('Restoring snapshot…')
    try {
      const response = await fetch('/api/codex/undo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.reason ?? 'No snapshot to restore')
      }
      setUndoMessage('Workspace restored from latest snapshot.')
      setSnapshotAvailable(false)
    } catch (err) {
      setUndoMessage(err instanceof Error ? err.message : 'Failed to restore snapshot')
    }
  }, [])

  const planComplete = useMemo(() => planItems.filter((item) => item.completed).length, [planItems])

  return (
    <aside className='hidden w-[360px] border-l border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--panel-foreground)] lg:flex lg:flex-col'>
      <div className='border-b border-[var(--panel-border)] px-6 py-5'>
        <p className='text-xs uppercase tracking-[0.3em] text-[var(--panel-muted)]'>Builder</p>
        <h2 className='text-lg font-semibold'>Codex Agent</h2>
        <p className='mt-2 text-xs text-[var(--panel-muted)]'>Run instructions, tweak theme colours, or undo the latest snapshot.</p>
      </div>

      <div className='flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm'>
        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Run prompt</h3>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            className='w-full rounded-md border border-[var(--panel-border)]/80 bg-transparent p-3 text-sm text-[var(--panel-foreground)] focus:border-[var(--accent-secondary)] focus:outline-none'
          />
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={runAgent}
              disabled={isRunning}
              className='rounded-md bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-white shadow hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:bg-[var(--panel-muted)]'
            >
              {isRunning ? 'Running…' : 'Run Codex'}
            </button>
            {isRunning ? (
              <button
                type='button'
                onClick={cancelRun}
                className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-xs text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)]'
              >
                Cancel
              </button>
            ) : null}
            {errorMessage ? (
              <span className='text-xs text-red-300'>{errorMessage}</span>
            ) : null}
          </div>
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Plan</h3>
          {planItems.length ? (
            <ul className='space-y-2 text-xs text-[var(--panel-muted)]'>
              {planItems.map((item) => (
                <li key={item.id} className='flex items-center gap-2'>
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${
                      item.completed ? 'bg-[var(--accent-secondary)]' : 'bg-[var(--panel-border)]'
                    }`}
                  />
                  <span className={item.completed ? 'line-through opacity-70' : ''}>{item.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-[var(--panel-muted)]'>Plan will appear when Codex responds.</p>
          )}
          {planItems.length ? (
            <p className='text-[10px] text-[var(--panel-muted)]'>Completed {planComplete} of {planItems.length} steps.</p>
          ) : null}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Commands</h3>
          {commands.length ? (
            <ul className='space-y-2 text-xs text-[var(--panel-muted)]'>
              {commands.map((command) => (
                <li key={command.id} className='rounded border border-[var(--panel-border)]/40 bg-black/10 p-2'>
                  <p className='font-mono text-[11px] text-[var(--panel-foreground)]'>{command.command}</p>
                  <p className='text-[10px] uppercase tracking-wide text-[var(--panel-muted)]'>Status: {command.status}</p>
                  {command.output ? (
                    <pre className='mt-1 max-h-24 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--panel-foreground)] whitespace-pre-wrap'>
                      {command.output}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-[var(--panel-muted)]'>Command output will appear here.</p>
          )}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>File changes</h3>
          {files.length ? (
            <ul className='space-y-2 text-xs text-[var(--panel-muted)]'>
              {files.map((change) => (
                <li key={change.id} className='rounded border border-[var(--panel-border)]/40 bg-black/10 p-2'>
                  <p className='mb-1 text-[10px] uppercase tracking-wide'>Status: {change.status}</p>
                  <ul className='space-y-1'>
                    {change.changes.map((entry, index) => (
                      <li key={`${change.id}-${index}`} className='flex items-center justify-between'>
                        <span className='font-mono text-[11px] text-[var(--panel-foreground)]'>{entry.path}</span>
                        <span className='text-[10px] uppercase tracking-wide'>{entry.kind}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-[var(--panel-muted)]'>No file edits yet.</p>
          )}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Messages</h3>
          {messages.length ? (
            <ul className='space-y-2 text-xs'>
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`rounded border border-[var(--panel-border)]/40 p-2 ${
                    message.tone === 'reasoning'
                      ? 'bg-black/5 text-[var(--panel-muted)]'
                      : message.tone === 'error'
                      ? 'bg-red-500/10 text-red-200'
                      : 'bg-white/5 text-[var(--panel-foreground)]'
                  }`}
                >
                  {message.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-[var(--panel-muted)]'>Assistant commentary will appear here.</p>
          )}
          {usage ? (
            <p className='text-[10px] text-[var(--panel-muted)]'>Usage — input: {usage.inputTokens} · output: {usage.outputTokens}</p>
          ) : null}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Theme controls</h3>
          <div className='flex flex-col gap-3 text-xs text-[var(--panel-muted)]'>
            <label className='flex items-center justify-between gap-3'>
              <span>Primary</span>
              <input type='color' value={primary} onChange={(event) => setPrimary(event.target.value)} className='h-8 w-16 border border-[var(--panel-border)] bg-transparent' />
            </label>
            <label className='flex items-center justify-between gap-3'>
              <span>Accent</span>
              <input type='color' value={accent} onChange={(event) => setAccent(event.target.value)} className='h-8 w-16 border border-[var(--panel-border)] bg-transparent' />
            </label>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={applyTheme}
                className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)]'
              >
                Apply theme
              </button>
              {themeMessage ? <span className='text-[10px] text-[var(--panel-muted)]'>{themeMessage}</span> : null}
            </div>
          </div>
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>Undo</h3>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={undoSnapshot}
              disabled={!snapshotAvailable}
              className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              Undo last snapshot
            </button>
            {undoMessage ? <span className='text-[10px] text-[var(--panel-muted)]'>{undoMessage}</span> : null}
          </div>
        </section>
      </div>
    </aside>
  )
}
