'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect, Group, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { Check, Crop, PenLine, StickyNote, Undo2, X } from 'lucide-react'

type Tool = 'pen' | 'crop' | 'note'

type LineStroke = {
  id: string
  color: string
  width: number
  points: number[]
}

type Sticky = {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: string
}

type NoteEditorState = {
  noteId: string
  value: string
  x: number
  y: number
  width: number
  height: number
}

type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

type EditorState = {
  lines: LineStroke[]
  notes: Sticky[]
  crop: CropRect | null
}

type InpaintingOverlayProps = {
  screenshot: string
  stageWidth: number
  stageHeight: number
  onCancel: () => void
  onComplete: (file: File) => Promise<void> | void
}

const PEN_COLOR = '#ef4444'
const PEN_WIDTH = 8
const NOTE_BODY_COLOR = '#fef08a'
const NOTE_BORDER = '#facc15'

const NOTE_SIZE = {
  width: 200,
  height: 120,
}

const createInitialState = (): EditorState => ({
  lines: [],
  notes: [],
  crop: null,
})

function cloneState(state: EditorState): EditorState {
  return {
    lines: state.lines.map((line) => ({
      ...line,
      points: [...line.points],
    })),
    notes: state.notes.map((note) => ({ ...note })),
    crop: state.crop ? { ...state.crop } : null,
  }
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isNoteNode(node: Konva.Node | null): boolean {
  let current: Konva.Node | null = node
  while (current) {
    if (current.hasName('note')) {
      return true
    }
    current = current.getParent()
  }
  return false
}

function useScreenshotImage(source: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!source) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!cancelled) {
        setImage(img)
      }
    }
    img.onerror = () => {
      if (!cancelled) {
        setImage(null)
      }
    }
    img.src = source
    return () => {
      cancelled = true
      img.onload = null
      img.onerror = null
    }
  }, [source])
  return image
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

export default function InpaintingOverlay({ screenshot, stageWidth, stageHeight, onCancel, onComplete }: InpaintingOverlayProps) {
  const [activeTool, setActiveTool] = useState<Tool>('pen')
  const [editorState, setEditorState] = useState<EditorState>(createInitialState)
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [textEditor, setTextEditor] = useState<NoteEditorState | null>(null)
  const [isCropPending, setIsCropPending] = useState(false)
  const [cropControls, setCropControls] = useState<{ x: number; y: number } | null>(null)
  const [cropStatus, setCropStatus] = useState<string | null>(null)
  const [baseImageSrc, setBaseImageSrc] = useState(screenshot)
  const [canvasSize, setCanvasSize] = useState({ width: stageWidth, height: stageHeight })
  const activeEditorId = textEditor?.noteId ?? null

  const historyRef = useRef<EditorState[]>([createInitialState()])
  const historyIndexRef = useRef(0)
  const editorStateRef = useRef(editorState)
  const stageRef = useRef<Konva.Stage | null>(null)
  const backgroundLayerRef = useRef<Konva.Layer | null>(null)
  const isDrawingRef = useRef(false)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)
  const stageWrapperRef = useRef<HTMLDivElement | null>(null)
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const isCropPendingRef = useRef(false)
  const cropStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const image = useScreenshotImage(baseImageSrc)

  useEffect(() => {
    const initial = createInitialState()
    setEditorState(initial)
    editorStateRef.current = initial
    historyRef.current = [cloneState(initial)]
    historyIndexRef.current = 0
    setHistoryIndex(0)
    setSelectedNoteId(null)
    setActiveTool('pen')
    setTextEditor(null)
    setIsCropPending(false)
    setCropControls(null)
    setCropStatus(null)
    setBaseImageSrc(screenshot)
    setCanvasSize({ width: stageWidth, height: stageHeight })
  }, [screenshot, stageWidth, stageHeight])

  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  useEffect(() => {
    if (activeEditorId && textEditorRef.current) {
      textEditorRef.current.focus()
      textEditorRef.current.select()
    }
  }, [activeEditorId])

  useEffect(() => {
    isCropPendingRef.current = isCropPending
  }, [isCropPending])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
      if (cropStatusTimeoutRef.current) {
        clearTimeout(cropStatusTimeoutRef.current)
      }
    }
  }, [])

  const showCropStatus = useCallback((message: string) => {
    if (cropStatusTimeoutRef.current) {
      clearTimeout(cropStatusTimeoutRef.current)
    }
    setCropStatus(message)
    cropStatusTimeoutRef.current = setTimeout(() => {
      setCropStatus(null)
      cropStatusTimeoutRef.current = null
    }, 2000)
  }, [])

  const applyEditorState = useCallback(
    (updater: (prev: EditorState) => EditorState, options?: { commit?: boolean }) => {
      setEditorState((prev) => {
        const next = updater(prev)
        editorStateRef.current = next
        if (options?.commit) {
          const snapshot = cloneState(next)
          const truncated = historyRef.current.slice(0, historyIndexRef.current + 1)
          truncated.push(snapshot)
          historyRef.current = truncated
          historyIndexRef.current = truncated.length - 1
          setHistoryIndex(historyIndexRef.current)
        }
        return next
      })
    },
    [],
  )

  const commitFromCurrent = useCallback(() => {
    const snapshot = cloneState(editorStateRef.current)
    const truncated = historyRef.current.slice(0, historyIndexRef.current + 1)
    truncated.push(snapshot)
    historyRef.current = truncated
    historyIndexRef.current = truncated.length - 1
    setHistoryIndex(historyIndexRef.current)
  }, [])

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current === 0) return
    const nextIndex = historyIndexRef.current - 1
    historyIndexRef.current = nextIndex
    setHistoryIndex(nextIndex)
    const snapshot = cloneState(historyRef.current[nextIndex])
    editorStateRef.current = snapshot
    setEditorState(snapshot)
  }, [])

  const getWrapperPoint = useCallback(
    (coords: { x: number; y: number }) => {
      if (!stageRef.current || !stageWrapperRef.current) return null
      const stageRect = stageRef.current.container().getBoundingClientRect()
      const wrapperRect = stageWrapperRef.current.getBoundingClientRect()
      return {
        x: stageRect.left - wrapperRect.left + coords.x,
        y: stageRect.top - wrapperRect.top + coords.y,
      }
    },
    [],
  )

  const updateCropControlsPosition = useCallback(() => {
    const crop = editorStateRef.current.crop
    if (crop) {
      const anchor = getWrapperPoint({
        x: crop.x + crop.width,
        y: crop.y,
      })
      if (anchor) {
        setCropControls(anchor)
        return
      }
    }
    setCropControls(null)
  }, [getWrapperPoint])

  useEffect(() => {
    updateCropControlsPosition()
  }, [updateCropControlsPosition, editorState.crop, canvasSize])

  useEffect(() => {
    const container = stageWrapperRef.current
    if (!container) return
    const handleScroll = () => updateCropControlsPosition()
    const handleResize = () => updateCropControlsPosition()
    container.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleResize)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [updateCropControlsPosition])

  const openEditor = useCallback(
    (note: Sticky) => {
      const origin = getWrapperPoint({ x: note.x, y: note.y })
      if (!origin) return
      setSelectedNoteId(note.id)
      setTextEditor({
        noteId: note.id,
        value: note.text,
        x: origin.x,
        y: origin.y,
        width: note.width,
        height: note.height,
      })
    },
    [getWrapperPoint],
  )

  const handleEditorChange = useCallback((value: string) => {
    setTextEditor((current) => (current ? { ...current, value } : current))
  }, [])

  const commitEditor = useCallback(
    (shouldSave: boolean) => {
      setTextEditor((current) => {
        if (!current) return null
        if (shouldSave) {
          const nextValue = current.value
          applyEditorState(
            (prev) => ({
              ...prev,
              notes: prev.notes.map((note) => (note.id === current.noteId ? { ...note, text: nextValue } : note)),
            }),
            { commit: true },
          )
        }
        return null
      })
    },
    [applyEditorState],
  )

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        commitEditor(false)
      } else if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        commitEditor(true)
      }
    },
    [commitEditor],
  )

  const startEditingNote = useCallback(
    (noteId: string) => {
      const note = editorStateRef.current.notes.find((entry) => entry.id === noteId)
      if (note) {
        openEditor(note)
      }
    },
    [openEditor],
  )

  const createNoteAt = useCallback(
    (point: { x: number; y: number }) => {
      const id = randomId()
      const newNote: Sticky = {
        id,
        x: point.x - NOTE_SIZE.width / 2,
        y: point.y - NOTE_SIZE.height / 2,
        width: NOTE_SIZE.width,
        height: NOTE_SIZE.height,
        text: '',
      }
      applyEditorState(
        (prev) => ({
          ...prev,
          notes: [...prev.notes, newNote],
        }),
        { commit: true },
      )
      openEditor(newNote)
    },
    [applyEditorState, openEditor],
  )

  const handlePointerDown = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      const stage = event.target.getStage()
      if (!stage) return
      const point = stage.getPointerPosition()
      if (!point) return

      if (textEditor) {
        commitEditor(true)
      }

      if (!isNoteNode(event.target)) {
        setSelectedNoteId(null)
      }

      if (activeTool === 'pen') {
        isDrawingRef.current = true
        const newLine: LineStroke = {
          id: randomId(),
          color: PEN_COLOR,
          width: PEN_WIDTH,
          points: [point.x, point.y],
        }
        applyEditorState((prev) => ({
          ...prev,
          lines: [...prev.lines, newLine],
        }))
        return
      }

      if (activeTool === 'crop') {
        cropStartRef.current = point
        setIsCropPending(true)
        applyEditorState((prev) => ({
          ...prev,
          crop: { x: point.x, y: point.y, width: 0, height: 0 },
        }))
        return
      }

      if (activeTool === 'note') {
        if (isNoteNode(event.target)) {
          return
        }
        createNoteAt(point)
      }
    },
    [activeTool, applyEditorState, commitEditor, createNoteAt, textEditor],
  )

  const handlePointerMove = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      const stage = event.target.getStage()
      if (!stage) return
      const point = stage.getPointerPosition()
      if (!point) return

      if (activeTool === 'pen' && isDrawingRef.current) {
        applyEditorState((prev) => {
          if (!prev.lines.length) return prev
          const nextLines = prev.lines.slice()
          const lastLine = { ...nextLines[nextLines.length - 1] }
          lastLine.points = [...lastLine.points, point.x, point.y]
          nextLines[nextLines.length - 1] = lastLine
          return {
            ...prev,
            lines: nextLines,
          }
        })
      }

      if (activeTool === 'crop' && cropStartRef.current) {
        const start = cropStartRef.current
        const width = point.x - start.x
        const height = point.y - start.y
        const rect: CropRect = {
          x: width < 0 ? point.x : start.x,
          y: height < 0 ? point.y : start.y,
          width: Math.abs(width),
          height: Math.abs(height),
        }
        applyEditorState((prev) => ({
          ...prev,
          crop: rect,
        }))
      }
    },
    [activeTool, applyEditorState],
  )

  const handlePointerUp = useCallback(() => {
    if (activeTool === 'pen' && isDrawingRef.current) {
      isDrawingRef.current = false
      commitFromCurrent()
    }
    if (activeTool === 'crop' && cropStartRef.current) {
      cropStartRef.current = null
      commitFromCurrent()
    }
  }, [activeTool, commitFromCurrent])

  const handleNoteDragEnd = useCallback(
    (noteId: string, position: { x: number; y: number }) => {
      if (textEditor?.noteId === noteId) {
        commitEditor(true)
      }
      applyEditorState(
        (prev) => ({
          ...prev,
          notes: prev.notes.map((note) => (note.id === noteId ? { ...note, x: position.x, y: position.y } : note)),
        }),
        { commit: true },
      )
    },
    [applyEditorState, commitEditor, textEditor],
  )

  const confirmCrop = useCallback(() => {
    const crop = editorStateRef.current.crop
    if (!crop || crop.width < 2 || crop.height < 2) {
      showCropStatus('Select a larger area before applying crop.')
      return
    }
    const cropX = Math.max(0, Math.floor(crop.x))
    const cropY = Math.max(0, Math.floor(crop.y))
    const maxWidth = Math.max(1, Math.floor(crop.width))
    const maxHeight = Math.max(1, Math.floor(crop.height))
    const nextWidth = Math.min(maxWidth, Math.max(1, canvasSize.width - cropX))
    const nextHeight = Math.min(maxHeight, Math.max(1, canvasSize.height - cropY))
    const layerCanvas = backgroundLayerRef.current?.toCanvas({
      x: cropX,
      y: cropY,
      width: nextWidth,
      height: nextHeight,
      pixelRatio: 1,
    })
    if (!layerCanvas) {
      showCropStatus('Unable to crop this image.')
      return
    }
    const nextSrc = layerCanvas.toDataURL('image/png')
    setBaseImageSrc(nextSrc)
    setCanvasSize({ width: nextWidth, height: nextHeight })
    applyEditorState(
      (prev) => ({
        ...prev,
        lines: prev.lines.map((line) => ({
          ...line,
          points: line.points.map((value, index) => (index % 2 === 0 ? value - cropX : value - cropY)),
        })),
        notes: prev.notes.map((note) => ({
          ...note,
          x: note.x - cropX,
          y: note.y - cropY,
        })),
        crop: null,
      }),
      { commit: true },
    )
    setIsCropPending(false)
    setCropControls(null)
    showCropStatus('Crop applied. Canvas resized.')
  }, [applyEditorState, canvasSize.height, canvasSize.width, showCropStatus])

  const cancelCrop = useCallback(() => {
    setIsCropPending(false)
    applyEditorState((prev) => ({
      ...prev,
      crop: null,
    }))
    showCropStatus('Crop cancelled.')
  }, [applyEditorState, showCropStatus])

  const handleDone = useCallback(async () => {
    if (!stageRef.current) return
    setOverlayError(null)
    setIsExporting(true)
    try {
      if (textEditor) {
        commitEditor(true)
      }
      const stage = stageRef.current
      const crop = isCropPendingRef.current ? null : editorStateRef.current.crop
      const hasCrop = crop && crop.width > 0 && crop.height > 0
      const dataUrl = stage.toDataURL({
        mimeType: 'image/png',
        pixelRatio: window.devicePixelRatio || 1,
        ...(hasCrop
          ? {
              x: crop!.x,
              y: crop!.y,
              width: crop!.width,
              height: crop!.height,
            }
          : {}),
      })
      const file = await dataUrlToFile(dataUrl, `inpainting-${Date.now()}.png`)
      await onComplete(file)
      onCancel()
    } catch (err) {
      console.error('Failed to export inpainting result', err)
      setOverlayError('인페인팅 이미지를 내보내지 못했어요.')
    } finally {
      setIsExporting(false)
    }
  }, [commitEditor, onCancel, onComplete, textEditor])

  const canUndo = historyIndex > 0

  const toolButtons: Array<{ id: Tool; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'pen', label: 'Pen', icon: PenLine },
    { id: 'crop', label: 'Crop', icon: Crop },
    { id: 'note', label: 'Note', icon: StickyNote },
  ]

  const overlayCursor = useMemo(() => {
    if (activeTool === 'pen' || activeTool === 'crop') {
      return 'crosshair'
    }
    if (activeTool === 'note') {
      return 'cell'
    }
    return 'default'
  }, [activeTool])

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur'>
      <div className='h-full w-full overflow-hidden px-6 py-8'>
        <div
          ref={stageWrapperRef}
          className='relative flex h-full w-full items-center justify-center overflow-auto rounded-xl border border-white/10 bg-black/30 p-4'
        >
          {image ? (
            <>
              <Stage
                width={canvasSize.width}
                height={canvasSize.height}
                ref={stageRef}
                className='max-h-full max-w-full'
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                style={{ cursor: overlayCursor }}
              >
                <Layer listening={false} ref={backgroundLayerRef}>
                  <KonvaImage image={image} width={canvasSize.width} height={canvasSize.height} listening={false} />
                </Layer>
                <Layer>
                  {editorState.lines.map((line) => (
                    <Line key={line.id} points={line.points} stroke={line.color} strokeWidth={line.width} lineCap='round' lineJoin='round' />
                  ))}
                  {editorState.notes.map((note) => {
                    const isSelected = selectedNoteId === note.id
                    return (
                      <Group
                        key={note.id}
                        x={note.x}
                        y={note.y}
                        draggable={textEditor?.noteId !== note.id}
                        name='note'
                        onClick={(event) => {
                          event.cancelBubble = true
                          setSelectedNoteId(note.id)
                        }}
                        onDragStart={() => {
                          setSelectedNoteId(note.id)
                          if (textEditor?.noteId === note.id) {
                            commitEditor(true)
                          }
                        }}
                        onDragEnd={(event) => {
                          event.cancelBubble = true
                          handleNoteDragEnd(note.id, { x: event.target.x(), y: event.target.y() })
                        }}
                        onDblClick={(event) => {
                          event.cancelBubble = true
                          startEditingNote(note.id)
                        }}
                      >
                        <Rect
                          width={note.width}
                          height={note.height}
                          cornerRadius={12}
                          fill={NOTE_BODY_COLOR}
                          stroke={isSelected ? NOTE_BORDER : 'transparent'}
                          strokeWidth={2}
                          shadowBlur={8}
                          shadowColor='rgba(15,23,42,0.4)'
                        />
                        <Text
                          text={note.text}
                          fill='#1e1b4b'
                          fontSize={16}
                          padding={16}
                          width={note.width}
                          height={note.height}
                          lineHeight={1.3}
                        />
                      </Group>
                    )
                  })}
                  {editorState.crop ? (
                    <Rect
                      x={editorState.crop.x}
                      y={editorState.crop.y}
                      width={editorState.crop.width}
                      height={editorState.crop.height}
                      stroke='#38bdf8'
                      dash={[6, 6]}
                      strokeWidth={2}
                      fill='rgba(56, 189, 248, 0.12)'
                    />
                  ) : null}
                </Layer>
              </Stage>
              {textEditor ? (
                <textarea
                  ref={textEditorRef}
                  value={textEditor.value}
                  onChange={(event) => handleEditorChange(event.target.value)}
                  onBlur={() => commitEditor(true)}
                  onKeyDown={handleEditorKeyDown}
                  className='rounded-xl border-2 border-[#facc15] bg-[#fef08a] p-4 text-base font-medium text-[#1e1b4b] shadow-xl outline-none'
                  style={{
                    position: 'absolute',
                    left: `${textEditor.x}px`,
                    top: `${textEditor.y}px`,
                    width: `${textEditor.width}px`,
                    height: `${textEditor.height}px`,
                    lineHeight: 1.3,
                    boxSizing: 'border-box',
                    resize: 'none',
                    zIndex: 10,
                  }}
                />
              ) : null}
              {editorState.crop && cropControls && isCropPending ? (
                <div
                  className='absolute flex gap-1 text-white'
                  style={{
                    left: `${cropControls.x + 8}px`,
                    top: `${cropControls.y - 12}px`,
                    zIndex: 12,
                  }}
                >
                  <button
                    type='button'
                    onClick={confirmCrop}
                    aria-label='Apply crop'
                    className='flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/70 text-white hover:bg-slate-900/80'
                  >
                    <Check className='h-3.5 w-3.5' />
                  </button>
                  <button
                    type='button'
                    onClick={cancelCrop}
                    aria-label='Cancel crop'
                    className='flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/70 text-white hover:bg-slate-900/80'
                  >
                    <X className='h-3.5 w-3.5' />
                  </button>
                </div>
              ) : null}
              {cropStatus ? (
                <div className='absolute left-4 top-4 rounded-full bg-slate-900/80 px-3 py-1 text-xs text-white shadow-lg'>
                  {cropStatus}
                </div>
              ) : null}
            </>
          ) : (
            <div className='text-sm text-white/80'>화면 캡처를 불러오는 중…</div>
          )}
        </div>
      </div>
      <div className='pointer-events-none fixed inset-x-0 bottom-8 flex justify-center px-4'>
        <div className='pointer-events-auto flex flex-wrap items-center gap-3 rounded-full bg-slate-900/70 px-5 py-3 text-sm text-white shadow-xl ring-1 ring-white/20 backdrop-blur'>
          {toolButtons.map((tool) => (
            <button
              key={tool.id}
              type='button'
              onClick={() => setActiveTool(tool.id)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                activeTool === tool.id ? 'bg-white/90 text-slate-900' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <tool.icon className='h-4 w-4' />
              {tool.label}
            </button>
          ))}
          <button
            type='button'
            onClick={handleUndo}
            disabled={!canUndo}
            className='flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <Undo2 className='h-4 w-4' />
            Undo
          </button>
          <span className='mx-1 h-5 w-px bg-white/30' aria-hidden='true' />
          <button
            type='button'
            onClick={onCancel}
            disabled={isExporting}
            className='flex items-center gap-2 rounded-full bg-white/0 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50'
          >
            <X className='h-4 w-4' />
            Cancel
          </button>
          <button
            type='button'
            onClick={handleDone}
            disabled={isExporting || !image}
            className='flex items-center gap-2 rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70'
          >
            <Check className='h-4 w-4' />
            {isExporting ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
      {overlayError ? <div className='absolute bottom-4 text-sm text-red-200'>{overlayError}</div> : null}
    </div>
  )
}
