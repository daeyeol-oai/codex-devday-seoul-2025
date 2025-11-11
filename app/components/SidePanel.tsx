'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

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

type DoneEventPayload = {
  ok?: boolean
  error?: string
  hasSnapshots?: boolean
  reason?: string
  finalResponse?: string
}

type Attachment = {
  id: string
  name: string
  status: 'uploading' | 'ready' | 'error'
  path?: string
  error?: string
}

const DEFAULT_PRIMARY = '#2563eb'
const DEFAULT_ACCENT = '#38bdf8'
const COLOR_HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ATTACHMENT_PROMPT_TEMPLATE =
  'Refer to the attached image. If annotation is provided in red pen or sticky note, follow those instructions.'


function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asDonePayload(value: unknown): DoneEventPayload | null {
  const record = asRecord(value)
  if (!record) return null
  const payload: DoneEventPayload = {}
  const ok = record['ok']
  if (typeof ok === 'boolean') {
    payload.ok = ok
  }
  const error = record['error']
  if (typeof error === 'string') {
    payload.error = error
  }
  const hasSnapshots = record['hasSnapshots']
  if (typeof hasSnapshots === 'boolean') {
    payload.hasSnapshots = hasSnapshots
  }
  const reason = record['reason']
  if (typeof reason === 'string') {
    payload.reason = reason
  }
  const finalResponse = record['finalResponse']
  if (typeof finalResponse === 'string') {
    payload.finalResponse = finalResponse
  }
  return payload
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function rgbToHex(value: string) {
  const normalized = value.replace(/\s+/g, '')
  const match = normalized.match(/^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/i)
  if (!match) return null
  const clamp = (component: string) => {
    const parsed = Number.parseInt(component, 10)
    if (Number.isNaN(parsed)) return 0
    return Math.max(0, Math.min(255, parsed))
  }
  const toHex = (component: number) => component.toString(16).padStart(2, '0')
  const [, r, g, b] = match
  return `#${toHex(clamp(r))}${toHex(clamp(g))}${toHex(clamp(b))}`.toLowerCase()
}

function normaliseColourToken(raw: string | undefined, fallback: string) {
  const value = raw?.trim()
  if (!value) return fallback
  if (COLOR_HEX_REGEX.test(value)) {
    return value.toLowerCase()
  }
  const rgb = rgbToHex(value)
  if (rgb) return rgb
  return fallback
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
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const controllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const hasAppliedAttachmentPromptRef = useRef(false)


  const [primary, setPrimary] = useState(DEFAULT_PRIMARY)
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [themeMessage, setThemeMessage] = useState<string | null>(null)
  const [undoMessage, setUndoMessage] = useState<string | null>(null)
  const [isThemeRunning, setIsThemeRunning] = useState(false)

  const refreshSnapshotAvailability = useCallback(async () => {
    try {
      const response = await fetch('/api/codex/snapshots', {
        method: 'GET',
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = (await response.json().catch(() => null)) as { ok?: unknown; hasSnapshots?: unknown } | null
      if (data && data.ok !== false && typeof data.hasSnapshots === 'boolean') {
        setSnapshotAvailable(Boolean(data.hasSnapshots))
      }
    } catch (err) {
      console.warn('Failed to load snapshot availability', err)
    }
  }, [])

  const resetState = useCallback(() => {
    setPlanItems([])
    setCommands([])
    setFiles([])
    setMessages([])
    setUsage(null)
    setErrorMessage(null)
  }, [])

  const uploadAttachment = useCallback(async (attachmentId: string, file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/uploads/image', {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; file?: { path?: unknown } }
        | null

      const storedPath =
        data && data.file && typeof data.file.path === 'string' ? (data.file.path as string) : null

      if (!response.ok || !storedPath) {
        const serverError = data && typeof data.error === 'string' ? (data.error as string) : null
        throw new Error(serverError ?? 'Failed to upload image')
      }

      setAttachments((prev) =>
        prev.map((item) => (item.id === attachmentId ? { ...item, status: 'ready', path: storedPath } : item)),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image'
      setAttachments((prev) =>
        prev.map((item) => (item.id === attachmentId ? { ...item, status: 'error', error: message } : item)),
      )
    }
  }, [])

  const handleFilesSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return

      const selections: Attachment[] = []
      Array.from(fileList).forEach((file) => {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const attachment: Attachment = {
          id,
          name: file.name || 'image',
          status: 'uploading',
        }
        selections.push(attachment)
        void uploadAttachment(id, file)
      })
      setAttachments((prev) => [...prev, ...selections])
      event.target.value = ''
    },
    [uploadAttachment],
  )

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId))
  }, [])

  const handleEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event === 'message') {
        const record = asRecord(payload)
        const type = asString(record?.type) ?? 'message'
        const text = asString(record?.text)
        const rawDetails = record && 'payload' in record ? (record.payload as unknown) : undefined
        const details = asRecord(rawDetails)

        const pushMessage = (tone: MessageItem['tone'] = 'assistant') => {
          if (text) {
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last && last.text === text && last.tone === tone) {
                return prev
              }
              return [
                ...prev,
                {
                  id: `${type}-${prev.length}`,
                  text,
                  tone,
                },
              ]
            })
          }
        }

        switch (type) {
          case 'plan.updated': {
            const items = Array.isArray(details?.items)
              ? (details?.items as Array<Record<string, unknown>>).map((item, index) => ({
                  id: `${index}`,
                  text: asString(item.text) ?? `Step ${index + 1}`,
                  completed: Boolean(item.completed),
                }))
              : []
            setPlanItems(items)
            pushMessage()
            break
          }
          case 'command.started':
          case 'command.updated':
          case 'command.completed': {
            setCommands((prev) => {
              const next = [...prev]
              const id = asString(details?.id) ?? `${next.length}`
              const index = next.findIndex((item) => item.id === id)
              const entry: CommandItem = {
                id,
                command: asString(details?.command) ?? next[index]?.command ?? 'command',
                status: asString(details?.status) ?? next[index]?.status ?? 'in_progress',
                exitCode: asNumber(details?.exitCode),
                output: asString(details?.output) ?? next[index]?.output,
              }
              if (index >= 0) {
                next[index] = { ...next[index], ...entry }
              } else {
                next.push(entry)
              }
              return next
            })
            pushMessage()
            break
          }
          case 'file.change': {
            setFiles((prev) => {
              const changes = Array.isArray(details?.changes)
                ? (details?.changes as Array<{ path: string; kind: string }>)
                : []
              return [
                ...prev,
                {
                  id: asString(details?.id) ?? `${prev.length}`,
                  status: asString(details?.status) ?? 'completed',
                  changes,
                },
              ]
            })
            pushMessage()
            break
          }
          case 'reasoning':
            pushMessage('reasoning')
            break
          case 'agent.message':
          case 'agent.final':
            pushMessage('assistant')
            break
          case 'error':
          case 'error.item':
            setErrorMessage(text ?? 'Codex run failed')
            pushMessage('error')
            break
          case 'turn.completed': {
            const usageRecord = details && asRecord(details.usage)
            if (usageRecord) {
              setUsage({
                inputTokens: asNumber(usageRecord.input_tokens) ?? 0,
                outputTokens: asNumber(usageRecord.output_tokens) ?? 0,
              })
            }
            pushMessage()
            break
          }
          case 'turn.failed':
            setErrorMessage(text ?? 'Codex run failed')
            pushMessage('error')
            break
          default:
            pushMessage('assistant')
            break
        }
        return
      }

      if (event === 'done') {
        const record = asRecord(payload)
        const ok = record ? Boolean(record.ok) : true
        setIsRunning(false)
        if (!ok && !errorMessage) {
          setErrorMessage('Codex run failed')
        }
        controllerRef.current = null
      }
    },
    [errorMessage],
  )

  const hasPendingUploads = useMemo(
    () => attachments.some((item) => item.status === 'uploading'),
    [attachments],
  )

  const runAgent = useCallback(async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setErrorMessage('Enter instructions before running Codex.')
      return
    }

    if (hasPendingUploads) {
      setErrorMessage('이미지 업로드가 끝난 뒤 다시 시도하세요.')
      return
    }

    const readyImages = attachments
      .filter((item) => item.status === 'ready' && typeof item.path === 'string')
      .map((item) => item.path as string)

    if (controllerRef.current) {
      controllerRef.current.abort()
    }

    resetState()
    setIsRunning(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const payload: Record<string, unknown> = { prompt: trimmedPrompt }
      if (readyImages.length > 0) {
        payload.images = readyImages
      }

      const response = await fetch('/api/codex/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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
  }, [attachments, handleEvent, hasPendingUploads, prompt, resetState])

  const cancelRun = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (attachments.length === 0) {
      hasAppliedAttachmentPromptRef.current = false
      return
    }
    if (!hasAppliedAttachmentPromptRef.current) {
      setPrompt(ATTACHMENT_PROMPT_TEMPLATE)
      hasAppliedAttachmentPromptRef.current = true
    }
  }, [attachments])
  
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    setPrimary((prev) => normaliseColourToken(styles.getPropertyValue('--accent-primary'), prev))
    setAccent((prev) => normaliseColourToken(styles.getPropertyValue('--accent-secondary'), prev))
    refreshSnapshotAvailability()
  }, [refreshSnapshotAvailability])

  const applyTheme = useCallback(async () => {
    if (!primary.trim() || !accent.trim()) {
      setThemeMessage('Select both colours before applying.')
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    resetState()
    setThemeMessage('Applying theme…')
    setIsThemeRunning(true)

    let donePayload: DoneEventPayload | null = null

    try {
      const response = await fetch('/api/codex/theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ primary: primary.trim(), accent: accent.trim() }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => '')
        throw new Error(message || 'Failed to start theme update')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const emit = (event: string, data: unknown) => {
        handleEvent(event, data)
        if (event === 'message') {
          const record = asRecord(data)
          if (record?.type === 'theme.completed') {
            const details = asRecord(record.payload)
            if (details && typeof details.hasSnapshots === 'boolean') {
              setSnapshotAvailable(Boolean(details.hasSnapshots))
            }
          }
        }
        if (event === 'done') {
          donePayload = asDonePayload(data)
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = parseSseChunk(buffer, emit)
      }

      if (buffer.length > 0) {
        parseSseChunk(buffer, emit)
      }

      const doneSummary: DoneEventPayload = donePayload ?? {}
      const { ok, error: doneError, hasSnapshots, reason } = doneSummary

      if (ok === false) {
        const message = typeof doneError === 'string' ? doneError : 'Codex theme update failed'
        throw new Error(message)
      }

      if (typeof hasSnapshots === 'boolean') {
        setSnapshotAvailable(hasSnapshots)
      }

      if (reason === 'no_changes') {
        setThemeMessage('Colours already up to date.')
      } else {
        setThemeMessage('Theme updated.')
      }

      await refreshSnapshotAvailability()
    } catch (err) {
      if (controller.signal.aborted) {
        setThemeMessage('Theme update cancelled.')
      } else {
        setThemeMessage(err instanceof Error ? err.message : 'Failed to apply theme')
      }
    } finally {
      setIsThemeRunning(false)
      controllerRef.current = null
    }
  }, [accent, handleEvent, primary, refreshSnapshotAvailability, resetState])

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
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok) {
        throw new Error(data.reason ?? 'No snapshot to restore')
      }
      setUndoMessage('Workspace restored from latest snapshot.')
      setSnapshotAvailable(Boolean(data.hasSnapshots))
      await refreshSnapshotAvailability()
    } catch (err) {
      setUndoMessage(err instanceof Error ? err.message : 'Failed to restore snapshot')
    }
  }, [refreshSnapshotAvailability])

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
          {attachments.length ? (
            <div className='space-y-2 rounded-md border border-[var(--panel-border)]/60 bg-white/5 p-3 text-xs'>
              <div className='flex items-center justify-between text-[var(--panel-muted)]'>
                <span className='font-semibold uppercase tracking-[0.2em]'>Attachments</span>
                <span>{attachments.length}</span>
              </div>
              <ul className='space-y-2'>
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className='flex items-center justify-between rounded border border-[var(--panel-border)]/40 bg-black/5 px-3 py-2 text-[var(--panel-foreground)]'
                  >
                    <div className='min-w-0 pr-3'>
                      <p className='truncate font-medium'>{attachment.name}</p>
                      <p className='text-[var(--panel-muted)]'>
                        {attachment.status === 'uploading'
                          ? 'Uploading…'
                          : attachment.status === 'error'
                          ? attachment.error ?? 'Upload failed'
                          : 'Ready'}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => removeAttachment(attachment.id)}
                      disabled={attachment.status === 'uploading' || isRunning}
                      className='text-[var(--panel-muted)] hover:text-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className='flex flex-wrap items-center gap-3'>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              multiple
              className='hidden'
              onChange={handleFilesSelected}
            />
            <button
              type='button'
              onClick={handleAttachClick}
              disabled={isRunning}
              className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-xs text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              Attach image
            </button>
            <button
              type='button'
              onClick={runAgent}
              disabled={isRunning || hasPendingUploads}
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
                disabled={isThemeRunning}
                className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isThemeRunning ? 'Updating…' : 'Apply theme'}
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
