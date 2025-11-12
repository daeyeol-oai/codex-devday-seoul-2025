'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ImageCarousel } from '@/app/components/ImageCarousel'
import { ImageGrid } from '@/app/components/ImageGrid'
import { VideoPlaceholder } from '@/app/components/VideoPlaceholder'
import type {
  GeneratedImage,
  ImageGenerationResponse,
  LatestAssetsResponse,
  VideoGenerationResponse,
  VideoProgressSnapshot,
} from '@/types/media'

type VideoResult = VideoGenerationResponse['video']

const PROGRESS_POLL_MS = 2000
const LEGACY_PROGRESS_FILE = 'progress.json'

function createClientVideoToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().split('-')[0]
  }
  return Math.random().toString(36).slice(2, 10)
}

function buildProgressPathFromToken(token: string) {
  return `videos/${token}/sora-progress-${token}.json`
}

export default function HomePage() {
  const [sketchFile, setSketchFile] = useState<File | null>(null)
  const [sketchLabel, setSketchLabel] = useState('No file chosen')
  const [sketchPreview, setSketchPreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [isLoadingLatest, setIsLoadingLatest] = useState(false)

  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoResult, setVideoResult] = useState<VideoResult | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false)

  const [progress, setProgress] = useState<VideoProgressSnapshot | null>(null)
  const [activeProgressPath, setActiveProgressPath] = useState<string | null>(null)
  const [isPollingProgress, setIsPollingProgress] = useState(false)
  const [usedReference, setUsedReference] = useState(false)
  const [cachedVideoAsset, setCachedVideoAsset] = useState<{
    runId: string
    fileName: string
    url: string
  } | null>(null)
  const [cachedVideoProgress, setCachedVideoProgress] = useState<VideoProgressSnapshot | null>(null)
  const [cachedVideoPrompt, setCachedVideoPrompt] = useState('')
  const hasAttemptedInitialLoad = useRef(false)

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedImageId) ?? null,
    [images, selectedImageId],
  )

  const canGenerateImages = prompt.trim().length > 0
  const canGenerateVideo = Boolean(selectedImage && (videoPrompt.trim().length > 0 || prompt.trim().length > 0))
  const canLoadStoredVideo = Boolean(
    cachedVideoAsset && runId && cachedVideoAsset.runId === runId && cachedVideoAsset.url,
  )

  const handleSketchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSketchFile(file)
    setSketchLabel(file ? file.name : 'No file chosen')
    if (file) {
      const previewUrl = URL.createObjectURL(file)
      setSketchPreview(previewUrl)
    } else {
      setSketchPreview(null)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (sketchPreview) {
        URL.revokeObjectURL(sketchPreview)
      }
    }
  }, [sketchPreview])

  const applyProgressSnapshot = useCallback((snapshot: VideoProgressSnapshot | null) => {
    setProgress(snapshot)
    if (snapshot) {
      const progressFile =
        typeof snapshot.progressFile === 'string' && snapshot.progressFile.length > 0
          ? snapshot.progressFile
          : LEGACY_PROGRESS_FILE
      setActiveProgressPath(progressFile)
    } else {
      setActiveProgressPath(null)
    }
  }, [])

  const handleLoadLatestVideo = useCallback(() => {
    if (!cachedVideoAsset || cachedVideoAsset.runId !== runId) {
      return
    }

    setVideoError(null)
    setVideoResult({
      url: cachedVideoAsset.url,
      fileName: cachedVideoAsset.fileName,
      id: `${cachedVideoAsset.runId}-latest-video`,
    })
    applyProgressSnapshot(cachedVideoProgress ?? null)
    if (cachedVideoPrompt) {
      setVideoPrompt(cachedVideoPrompt)
    }
  }, [applyProgressSnapshot, cachedVideoAsset, cachedVideoProgress, cachedVideoPrompt, runId])

  const handleGenerateImages = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!prompt.trim()) {
      setImageError('프롬프트를 입력해주세요.')
      return
    }

    setImageError(null)
    setIsGeneratingImages(true)
    setVideoResult(null)
    applyProgressSnapshot(null)
    setSelectedImageId(null)
    setCachedVideoAsset(null)
    setCachedVideoProgress(null)
    setCachedVideoPrompt('')

    try {
      const formData = new FormData()
      formData.append('prompt', prompt.trim())
      if (sketchFile) {
        formData.append('sketch', sketchFile)
      }

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to generate images')
      }

      const payload = (await response.json()) as ImageGenerationResponse
      setRunId(payload.runId)
      setImages(payload.images)
      setSelectedImageId(payload.images[0]?.id ?? null)
      setVideoPrompt('')
      setVideoError(null)
      setUsedReference(Boolean(payload.usedReference))
      if (!payload.usedReference) {
        setSketchFile(null)
        setSketchLabel('No file chosen')
        setSketchPreview(null)
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Failed to generate images')
    } finally {
      setIsGeneratingImages(false)
    }
  }, [applyProgressSnapshot, prompt, sketchFile])

  const handleLoadLatest = useCallback(async () => {
    setImageError(null)
    setIsLoadingLatest(true)
    try {
      const response = await fetch('/api/images/latest', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('최근 생성된 이미지가 없습니다.')
        }
        const message = await response.text()
        throw new Error(message || '이미지를 불러오지 못했습니다.')
      }

      const payload = (await response.json()) as LatestAssetsResponse
      if (!payload.images?.length) {
        throw new Error('최근 생성된 이미지가 없습니다.')
      }

      const latestPrompt = payload.metadata?.prompt ?? ''

      setRunId(payload.runId)
      const mappedImages: GeneratedImage[] = payload.images.map((image, index) => ({
        id: `${payload.runId}-latest-${index}`,
        fileName: image.fileName,
        url: image.url,
        width: undefined,
        height: undefined,
        createdAt: image.updatedAt,
        model: 'gpt-image-1-mini',
        size: '1536x1024',
      }))
      setImages(mappedImages)
      setSelectedImageId(mappedImages[0]?.id ?? null)
      setPrompt(latestPrompt)
      const snapshot = payload.progress ? (payload.progress as VideoProgressSnapshot) : null
      if (payload.video) {
        const promptFromSnapshot = snapshot?.prompt ?? ''
        const resolvedPrompt = promptFromSnapshot || latestPrompt

        setCachedVideoAsset({
          runId: payload.runId,
          fileName: payload.video.fileName,
          url: payload.video.url,
        })
        setCachedVideoProgress(snapshot)
        setCachedVideoPrompt(resolvedPrompt)
        setVideoResult({
          url: payload.video.url,
          fileName: payload.video.fileName,
          id: `${payload.runId}-latest-video`,
        })
        applyProgressSnapshot(snapshot ?? null)
        setVideoPrompt(resolvedPrompt)
      } else {
        setCachedVideoAsset(null)
        setCachedVideoProgress(null)
        setCachedVideoPrompt('')
        setVideoResult(null)
        applyProgressSnapshot(null)
      }
      setVideoError(null)
      setUsedReference(Boolean(payload.metadata?.usedReference))
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '이미지를 불러오지 못했습니다.')
    } finally {
      setIsLoadingLatest(false)
    }
  }, [applyProgressSnapshot])

  useEffect(() => {
    if (hasAttemptedInitialLoad.current) {
      return
    }

    hasAttemptedInitialLoad.current = true
    void handleLoadLatest()
  }, [handleLoadLatest])

  useEffect(() => {
    if (!isPollingProgress || !runId || !activeProgressPath) {
      return undefined
    }

    let isCancelled = false

    const poll = async () => {
      try {
        const response = await fetch(`/outputs/${runId}/${activeProgressPath}?ts=${Date.now()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (response.status === 404) return
          throw new Error('Unable to read progress')
        }

        const snapshot = (await response.json()) as VideoProgressSnapshot
        if (!isCancelled) {
          applyProgressSnapshot(snapshot)
          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
            setIsPollingProgress(false)
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.warn('Progress polling failed', err)
        }
      }
    }

    poll()
    const interval = setInterval(poll, PROGRESS_POLL_MS)
    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [activeProgressPath, applyProgressSnapshot, isPollingProgress, runId])

  const handleGenerateVideo = useCallback(async () => {
    if (!selectedImage || !runId) {
      setVideoError('Select an image before requesting a video.')
      return
    }

    const videoPromptValue = videoPrompt.trim() || prompt.trim()
    if (!videoPromptValue) {
      setVideoError('Provide guidance for the video prompt.')
      return
    }

    const videoToken = createClientVideoToken()
    const progressPath = buildProgressPathFromToken(videoToken)

    setVideoError(null)
    setVideoResult(null)
    applyProgressSnapshot(null)
    setIsGeneratingVideo(true)
    setActiveProgressPath(progressPath)
    setIsPollingProgress(true)

    try {
      const response = await fetch('/api/videos/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: videoPromptValue,
          imageUrl: selectedImage.url,
          runId,
          size: '1280x720',
          seconds: 8,
          token: videoToken,
        }),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Video generation failed')
      }

      const payload = (await response.json()) as VideoGenerationResponse
      setVideoResult(payload.video)
      applyProgressSnapshot(payload.progress)
      setCachedVideoAsset({
        runId,
        fileName: payload.video.fileName,
        url: payload.video.url,
      })
      setCachedVideoProgress(payload.progress)
      setCachedVideoPrompt(payload.progress.prompt || videoPromptValue)
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Video generation failed')
    } finally {
      setIsGeneratingVideo(false)
      setIsPollingProgress(false)
    }
  }, [applyProgressSnapshot, prompt, selectedImage, videoPrompt, runId])

  return (
    <div className='mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 lg:px-10'>
      <header className='space-y-3'>
        <p className='text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500'>Builder</p>
        <h1 className='text-3xl font-semibold tracking-tight text-zinc-900'>Building Stories</h1>
        <p className='max-w-2xl text-sm text-zinc-600'>
          Upload a sketch, describe the scene, and let GPT Image and Sora craft your visual storyboard.
        </p>
      </header>

      <section className='space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm'>
        <form onSubmit={handleGenerateImages} className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)_auto]'>
            <div className='flex flex-col gap-2'>
              <label className='flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm hover:border-zinc-300'>
                <span>Upload</span>
                <input type='file' accept='image/*' onChange={handleSketchChange} className='hidden' />
                <span className='truncate text-xs text-zinc-500'>{sketchLabel}</span>
              </label>
              {sketchPreview ? (
                <div className='rounded-lg border border-zinc-200 bg-white/70 p-2 shadow-sm'>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sketchPreview}
                    alt='Selected sketch preview'
                    className='h-28 w-full rounded-md object-cover'
                  />
                </div>
              ) : null}
            </div>
            <input
              type='text'
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder='Describe your sketch...'
              className='rounded-lg border border-zinc-200 px-4 py-3 text-sm shadow-sm focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]'
            />
            <div className='flex items-center gap-3'>
              <button
                type='submit'
                disabled={!canGenerateImages || isGeneratingImages}
                className='rounded-lg bg-[var(--accent-primary)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isGeneratingImages ? 'Generating…' : 'Generate images'}
              </button>
              <button
                type='button'
                onClick={handleLoadLatest}
                disabled={isGeneratingImages || isLoadingLatest}
                className='rounded-lg border border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400'
              >
                {isLoadingLatest ? 'Loading…' : 'Load latest'}
              </button>
            </div>
          </div>
        </form>
        {imageError ? <p className='text-sm text-red-500'>{imageError}</p> : null}
        {images.length ? (
          <p className='text-xs text-zinc-500'>
            {usedReference ? 'Reference sketch applied to this run.' : 'Generated from prompt only.'}
          </p>
        ) : null}
      </section>

      <section className='grid gap-6 lg:grid-cols-[2fr,1.2fr]'>
        <ImageCarousel images={images} selectedId={selectedImageId} onSelect={(image) => setSelectedImageId(image.id)} />
        <div className='space-y-4'>
          <ImageGrid images={images} selectedId={selectedImageId} onSelect={(image) => setSelectedImageId(image.id)} />
          {selectedImage ? (
            <div className='rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm'>
              <p className='font-medium text-zinc-900'>{selectedImage.fileName}</p>
              <p className='text-xs text-zinc-500'>Model: {selectedImage.model} · Size: {selectedImage.size}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className='grid gap-6 lg:grid-cols-[1.5fr,1fr]'>
        <div className='space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm'>
          <h2 className='text-lg font-semibold text-zinc-900'>Create a video with Sora</h2>
          <p className='text-sm text-zinc-600'>Describe the motion or narrative for your final clip, then submit to Sora.</p>
          <textarea
            value={videoPrompt}
            onChange={(event) => setVideoPrompt(event.target.value)}
            placeholder='Describe the pacing, camera moves, and tone of the video...'
            rows={4}
            className='w-full rounded-lg border border-zinc-200 px-4 py-3 text-sm shadow-sm focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]'
          />
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={handleGenerateVideo}
              disabled={!canGenerateVideo || isGeneratingVideo}
              className='rounded-lg bg-[var(--accent-primary)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isGeneratingVideo ? 'Submitting to Sora…' : 'Create video'}
            </button>
            {canLoadStoredVideo ? (
              <button
                type='button'
                onClick={handleLoadLatestVideo}
                disabled={isGeneratingVideo}
                className='rounded-lg border border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400'
              >
                Load latest
              </button>
            ) : null}
            <p className='text-sm text-zinc-500'>Target: 8s · 1280×720</p>
          </div>
          {videoError ? <p className='text-sm text-red-500'>{videoError}</p> : null}
        </div>

        <VideoPlaceholder progress={progress} videoUrl={videoResult?.url ?? null} isGenerating={isGeneratingVideo || isPollingProgress} />
      </section>
    </div>
  )
}
