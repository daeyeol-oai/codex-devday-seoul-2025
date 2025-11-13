'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { toPng } from 'html-to-image'
import { ImageUp, Menu, Paintbrush, X } from 'lucide-react'

import InpaintingOverlay from './InpaintingOverlay'

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
  '첨부한 이미지를 참고해줘. 빨간 펜이나 스티커 메모로 적힌 안내가 있다면 그대로 따라줘.'


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
  const [prompt, setPrompt] = useState('최근 변경사항을 요약하고 다음 UI 개선 아이디어를 제안해줘.')
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [planItems, setPlanItems] = useState<PlanItem[]>([])
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [files, setFiles] = useState<FileChangeItem[]>([])
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [snapshotAvailable, setSnapshotAvailable] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isInpaintingOpen, setIsInpaintingOpen] = useState(false)
  const [inpaintingImage, setInpaintingImage] = useState<string | null>(null)
  const [inpaintingSize, setInpaintingSize] = useState<{ width: number; height: number } | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

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
        throw new Error(serverError ?? '이미지를 업로드하지 못했습니다.')
      }

      setAttachments((prev) =>
        prev.map((item) => (item.id === attachmentId ? { ...item, status: 'ready', path: storedPath } : item)),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '이미지를 업로드하지 못했습니다.'
      setAttachments((prev) =>
        prev.map((item) => (item.id === attachmentId ? { ...item, status: 'error', error: message } : item)),
      )
    }
  }, [])

  const addAttachmentFromFile = useCallback(
    (file: File) => {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const attachment: Attachment = {
        id,
        name: file.name || 'image',
        status: 'uploading',
      }
      setAttachments((prev) => [...prev, attachment])
      void uploadAttachment(id, file)
    },
    [uploadAttachment],
  )

  const handleFilesSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return

      Array.from(fileList).forEach((file) => {
        addAttachmentFromFile(file)
      })
      event.target.value = ''
    },
    [addAttachmentFromFile],
  )

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId))
  }, [])

  const handleOverlayClose = useCallback(() => {
    setIsInpaintingOpen(false)
    setInpaintingImage(null)
    setInpaintingSize(null)
  }, [])

  const handleOverlayComplete = useCallback(
    (file: File) => {
      addAttachmentFromFile(file)
    },
    [addAttachmentFromFile],
  )

  const handleStartInpainting = useCallback(async () => {
    if (typeof document === 'undefined') return
    try {
      setIsCapturing(true)
      const target = document.documentElement
      const width = Math.max(target.scrollWidth, target.clientWidth)
      const height = Math.max(target.scrollHeight, target.clientHeight)
      const dataUrl = await toPng(target, {
        cacheBust: true,
        width,
        height,
        style: {
          transform: 'none',
        },
      })
      setInpaintingImage(dataUrl)
      setInpaintingSize({ width, height })
      setIsInpaintingOpen(true)
    } catch (err) {
      console.error('Failed to capture viewport for inpainting', err)
      setErrorMessage('화면 캡처에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setIsCapturing(false)
    }
  }, [setErrorMessage])

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
            setErrorMessage(text ?? 'Codex 실행에 실패했습니다.')
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
            setErrorMessage(text ?? 'Codex 실행에 실패했습니다.')
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
          setErrorMessage('Codex 실행에 실패했습니다.')
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
      setErrorMessage('코덱스를 실행하기 전에 지시문을 입력해주세요.')
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
        throw new Error(message || 'Codex 실행을 시작하지 못했습니다.')
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
        setErrorMessage('Codex 실행이 취소되었습니다.')
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Codex 실행에 실패했습니다.')
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
      setThemeMessage('두 색상을 모두 선택한 뒤 적용해주세요.')
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    resetState()
    setThemeMessage('테마를 적용하는 중…')
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
        throw new Error(message || '테마 업데이트를 시작하지 못했습니다.')
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
        const message = typeof doneError === 'string' ? doneError : 'Codex 테마 업데이트에 실패했습니다.'
        throw new Error(message)
      }

      if (typeof hasSnapshots === 'boolean') {
        setSnapshotAvailable(hasSnapshots)
      }

      if (reason === 'no_changes') {
        setThemeMessage('이미 최신 색상입니다.')
      } else {
        setThemeMessage('테마가 업데이트되었습니다.')
      }

      await refreshSnapshotAvailability()
    } catch (err) {
      if (controller.signal.aborted) {
        setThemeMessage('테마 업데이트가 취소되었습니다.')
      } else {
        setThemeMessage(err instanceof Error ? err.message : '테마를 적용하지 못했습니다.')
      }
    } finally {
      setIsThemeRunning(false)
      controllerRef.current = null
    }
  }, [accent, handleEvent, primary, refreshSnapshotAvailability, resetState])

  const undoSnapshot = useCallback(async () => {
    setUndoMessage('스냅샷을 복원하는 중…')
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
        throw new Error(data.reason ?? '복원할 스냅샷이 없습니다.')
      }
      setUndoMessage('최근 스냅샷으로 작업 공간을 되돌렸어요.')
      setSnapshotAvailable(Boolean(data.hasSnapshots))
      await refreshSnapshotAvailability()
    } catch (err) {
      setUndoMessage(err instanceof Error ? err.message : '스냅샷을 복원하지 못했습니다.')
    }
  }, [refreshSnapshotAvailability])

  const planComplete = useMemo(() => planItems.filter((item) => item.completed).length, [planItems])

  return (
    <>
      {!isPanelOpen ? (
        <button
          type='button'
          onClick={() => setIsPanelOpen(true)}
          aria-label='도움말 패널 열기'
          className='fixed right-0 top-3 z-40 hidden items-center rounded-l-lg border border-[var(--panel-border)] bg-[var(--panel-background)] p-3 text-[var(--panel-foreground)] shadow lg:flex'
        >
          <Menu className='h-4 w-4' aria-hidden='true' />
        </button>
      ) : null}

      <div
        className={`relative hidden flex-shrink-0 overflow-visible transition-[width] duration-300 lg:block ${
          isPanelOpen ? 'w-[360px]' : 'w-0'
        }`}
      >
        <div className='sticky top-0 h-screen w-[360px]'>
          <aside
            className={`flex h-full w-[360px] flex-col border-l border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--panel-foreground)] shadow-xl transition-transform duration-300 ${
              isPanelOpen ? 'pointer-events-auto translate-x-0' : 'pointer-events-none translate-x-full'
            }`}
          >
          <div className='border-b border-[var(--panel-border)] px-6 py-5'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs uppercase tracking-[0.3em] text-[var(--panel-muted)]'>도움 모드</p>
                <h2 className='text-lg font-semibold'>Codex 에이전트</h2>
                <p className='mt-2 text-xs text-[var(--panel-muted)]'>지시를 실행하고 테마 색상을 조정하거나 최근 스냅샷을 복원할 수 있어요.</p>
              </div>
              <button
                type='button'
                onClick={() => setIsPanelOpen(false)}
                aria-label='도움말 패널 닫기'
                className='rounded-md border border-[var(--panel-border)] p-2 text-[var(--panel-muted)] hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>
          </div>

          <div className='builder-sidebar-scroll flex-1 min-h-0 space-y-5 overflow-y-auto pl-6 pr-4 py-5 text-sm'>
        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>실행 프롬프트</h3>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            className='w-full rounded-md border border-[var(--panel-border)]/80 bg-transparent p-3 text-sm text-[var(--panel-foreground)] focus:border-[var(--accent-secondary)] focus:outline-none'
          />
          {attachments.length ? (
            <div className='space-y-2 rounded-md border border-[var(--panel-border)]/60 bg-white/5 p-3 text-xs'>
              <div className='flex items-center justify-between text-[var(--panel-muted)]'>
                <span className='font-semibold uppercase tracking-[0.2em]'>첨부 이미지</span>
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
                          ? '업로드 중…'
                          : attachment.status === 'error'
                          ? attachment.error ?? '업로드 실패'
                          : '준비 완료'}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => removeAttachment(attachment.id)}
                      disabled={attachment.status === 'uploading' || isRunning}
                      className='text-[var(--panel-muted)] hover:text-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className='flex items-center gap-3'>
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
              onClick={handleStartInpainting}
              disabled={isRunning || isCapturing || isInpaintingOpen}
              aria-label='인페인팅 오버레이 열기'
              title='인페인팅'
              className='rounded-md border border-[var(--panel-border)] p-2 text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isCapturing ? (
                <span className='text-[10px] uppercase tracking-wide'>…</span>
              ) : (
                <Paintbrush className='h-4 w-4' />
              )}
            </button>
            <button
              type='button'
              onClick={handleAttachClick}
              disabled={isRunning || isCapturing}
              aria-label='참고 이미지 업로드'
              title='이미지 업로드'
              className='rounded-md border border-[var(--panel-border)] p-2 text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              <ImageUp className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={runAgent}
              disabled={isRunning || hasPendingUploads}
              className='rounded-md bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-white shadow hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:bg-[var(--panel-muted)]'
            >
              {isRunning ? '실행 중…' : 'Codex 실행'}
            </button>
            {isRunning ? (
              <button
                type='button'
                onClick={cancelRun}
                className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-xs text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)]'
              >
                취소
              </button>
            ) : null}
            {errorMessage ? (
              <span className='text-xs text-red-300'>{errorMessage}</span>
            ) : null}
          </div>
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>계획</h3>
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
            <p className='text-xs text-[var(--panel-muted)]'>Codex 응답이 오면 계획이 여기에 표시됩니다.</p>
          )}
          {planItems.length ? (
            <p className='text-[10px] text-[var(--panel-muted)]'>총 {planItems.length}개 중 {planComplete}개 완료</p>
          ) : null}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>명령 내역</h3>
          {commands.length ? (
            <ul className='space-y-2 text-xs text-[var(--panel-muted)]'>
              {commands.map((command) => (
                <li key={command.id} className='rounded border border-[var(--panel-border)]/40 bg-black/10 p-2'>
                  <p className='font-mono text-[11px] text-[var(--panel-foreground)]'>{command.command}</p>
                  <p className='text-[10px] uppercase tracking-wide text-[var(--panel-muted)]'>상태: {command.status}</p>
                  {command.output ? (
                    <pre className='mt-1 max-h-24 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--panel-foreground)] whitespace-pre-wrap'>
                      {command.output}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-[var(--panel-muted)]'>명령 실행 결과가 여기에 표시됩니다.</p>
          )}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>파일 변경</h3>
          {files.length ? (
            <ul className='space-y-2 text-xs text-[var(--panel-muted)]'>
              {files.map((change) => (
                <li key={change.id} className='rounded border border-[var(--panel-border)]/40 bg-black/10 p-2'>
                  <p className='mb-1 text-[10px] uppercase tracking-wide'>상태: {change.status}</p>
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
            <p className='text-xs text-[var(--panel-muted)]'>아직 파일 변경이 없습니다.</p>
          )}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>메시지</h3>
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
            <p className='text-xs text-[var(--panel-muted)]'>어시스턴트 메시지가 여기에 표시됩니다.</p>
          )}
          {usage ? (
            <p className='text-[10px] text-[var(--panel-muted)]'>토큰 사용량 — 입력: {usage.inputTokens} · 출력: {usage.outputTokens}</p>
          ) : null}
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>테마 설정</h3>
          <div className='flex flex-col gap-3 text-xs text-[var(--panel-muted)]'>
            <label className='flex items-center justify-between gap-3'>
              <span>기본 색상</span>
              <input type='color' value={primary} onChange={(event) => setPrimary(event.target.value)} className='h-8 w-16 border border-[var(--panel-border)] bg-transparent' />
            </label>
            <label className='flex items-center justify-between gap-3'>
              <span>포인트 색상</span>
              <input type='color' value={accent} onChange={(event) => setAccent(event.target.value)} className='h-8 w-16 border border-[var(--panel-border)] bg-transparent' />
            </label>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={applyTheme}
                disabled={isThemeRunning}
                className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isThemeRunning ? '업데이트 중…' : '테마 적용'}
              </button>
              {themeMessage ? <span className='text-[10px] text-[var(--panel-muted)]'>{themeMessage}</span> : null}
            </div>
          </div>
        </section>

        <section className='space-y-3 rounded-lg border border-[var(--panel-border)]/60 bg-white/5 p-4'>
          <h3 className='text-xs font-semibold uppercase tracking-[0.2em] text-[var(--panel-muted)]'>되돌리기</h3>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={undoSnapshot}
              disabled={!snapshotAvailable}
              className='rounded-md border border-[var(--panel-border)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--panel-foreground)] hover:border-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
            >
              마지막 스냅샷 되돌리기
            </button>
            {undoMessage ? <span className='text-[10px] text-[var(--panel-muted)]'>{undoMessage}</span> : null}
          </div>
        </section>
        </div>
      </aside>
      </div>
      </div>
      {isInpaintingOpen && inpaintingImage && inpaintingSize ? (
        <InpaintingOverlay
          screenshot={inpaintingImage}
          stageWidth={inpaintingSize.width}
          stageHeight={inpaintingSize.height}
          onCancel={handleOverlayClose}
          onComplete={handleOverlayComplete}
        />
      ) : null}
    </>
  )
}
