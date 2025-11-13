'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const [sketchLabel, setSketchLabel] = useState('선택된 파일 없음')
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

  const panelClass = 'glass-panel p-6 lg:p-8'

  const canGenerateImages = prompt.trim().length > 0
  const canGenerateVideo = Boolean(selectedImage && (videoPrompt.trim().length > 0 || prompt.trim().length > 0))
  const canLoadStoredVideo = Boolean(
    cachedVideoAsset && runId && cachedVideoAsset.runId === runId && cachedVideoAsset.url,
  )

  const handleSketchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSketchFile(file)
    setSketchLabel(file ? file.name : '선택된 파일 없음')
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
        throw new Error(message || '이미지 생성에 실패했습니다.')
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
        setSketchLabel('선택된 파일 없음')
        setSketchPreview(null)
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '이미지 생성에 실패했습니다.')
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
          throw new Error('진행 정보를 불러올 수 없습니다.')
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
      setVideoError('비디오를 요청하기 전에 이미지를 선택해주세요.')
      return
    }

    const videoPromptValue = videoPrompt.trim() || prompt.trim()
    if (!videoPromptValue) {
      setVideoError('비디오 프롬프트에 대한 설명을 입력해주세요.')
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
        throw new Error(message || '비디오 생성에 실패했습니다.')
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
      setVideoError(err instanceof Error ? err.message : '비디오 생성에 실패했습니다.')
    } finally {
      setIsGeneratingVideo(false)
      setIsPollingProgress(false)
    }
  }, [applyProgressSnapshot, prompt, selectedImage, videoPrompt, runId])

  return (
    <div className='relative isolate min-h-screen w-full overflow-hidden px-4 py-10 sm:px-8 lg:px-12'>
      <div className='pointer-events-none absolute -left-16 top-8 h-72 w-72 rounded-full bg-pink-200/40 blur-3xl' aria-hidden='true' />
      <div className='pointer-events-none absolute right-4 top-10 h-64 w-64 rounded-full bg-cyan-200/30 blur-3xl' aria-hidden='true' />
      <div className='pointer-events-none absolute -bottom-10 left-1/3 h-72 w-72 rounded-full bg-amber-100/50 blur-3xl' aria-hidden='true' />

      <div className='relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 lg:gap-10'>
        <header className={`${panelClass} space-y-5 text-slate-900 shadow-[0_35px_120px_rgba(248,191,248,0.4)]`}>
          <p className='text-xs font-semibold uppercase tracking-[0.5em] text-pink-500'>꿈 제작소</p>
          <div className='space-y-3'>
            <h1 className='text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl'>스케치로 시작하는 상상 아틀리에</h1>
            <p className='text-base text-slate-600'>손그림이나 낙서를 올리고 이야기를 적으면 GPT Image가 5장의 장면을 만들고, 마음에 드는 한 장을 선택해 소라 비디오까지 이어서 만들어 보세요.</p>
          </div>
          <div className='flex flex-wrap gap-3 text-xs font-semibold text-pink-600'>
            <span className='rounded-full bg-pink-100/70 px-3 py-1'>1. 스케치</span>
            <span className='rounded-full bg-violet-100/70 px-3 py-1'>2. 프롬프트</span>
            <span className='rounded-full bg-cyan-100/70 px-3 py-1'>3. 비디오</span>
          </div>
        </header>

        <section className='grid gap-6 lg:grid-cols-[0.95fr_1.05fr]'>
          <div className={`${panelClass} space-y-5`}>
            <div className='space-y-2'>
              <p className='text-sm font-semibold text-pink-600'>스케치 캔버스</p>
              <p className='text-xs text-slate-500'>선으로 그린 아이디어, 사진, 낙서를 자유롭게 올려 AI에게 힌트를 주세요.</p>
            </div>
            <label htmlFor='sketch-upload' className='flex cursor-pointer flex-col gap-2 rounded-2xl border border-dashed border-pink-200/70 bg-white/60 px-4 py-5 text-sm font-semibold text-slate-700 shadow-inner transition hover:border-pink-400'>
              <span>스케치 업로드</span>
              <span className='text-xs font-normal text-slate-500'>{sketchLabel}</span>
              <span className='text-[11px] font-normal text-slate-400'>PNG, JPG, GIF 모두 가능해요.</span>
            </label>
            <input id='sketch-upload' type='file' accept='image/*' onChange={handleSketchChange} className='hidden' />
            {sketchPreview ? (
              <div className='rounded-2xl border border-white/70 bg-white/80 p-3 shadow-inner'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sketchPreview} alt='선택한 스케치 미리보기' className='h-44 w-full rounded-xl object-cover' />
              </div>
            ) : (
              <div className='rounded-2xl border border-dashed border-white/70 bg-white/40 p-6 text-center text-sm text-slate-400'>
                업로드하면 미리보기가 여기에 보여요.
              </div>
            )}
            <ul className='space-y-2 text-xs text-slate-500'>
              <li className='flex items-center gap-2'><span className='h-1.5 w-1.5 rounded-full bg-pink-400' /> 10MB 이하의 이미지 권장</li>
              <li className='flex items-center gap-2'><span className='h-1.5 w-1.5 rounded-full bg-violet-400' /> 빨간 펜이나 스티커 메모도 감지돼요</li>
              <li className='flex items-center gap-2'><span className='h-1.5 w-1.5 rounded-full bg-cyan-400' /> 스케치가 없으면 텍스트만으로도 생성됩니다</li>
            </ul>
          </div>

          <form onSubmit={handleGenerateImages} className={`${panelClass} flex flex-col gap-5`}>
            <div className='space-y-3'>
              <p className='text-sm font-semibold text-pink-600'>스토리 프롬프트</p>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={7}
                placeholder='예: 푸른 잔디밭 위에서 크레용으로 그린 로봇이 친구들과 피크닉을 즐기는 장면을 그리고 싶어요.'
                className='min-h-[160px] rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-slate-800 shadow-inner focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30'
              />
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <button
                type='submit'
                disabled={!canGenerateImages || isGeneratingImages}
                className='inline-flex flex-1 items-center justify-center rounded-2xl bg-[var(--accent-primary)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-200/60 transition hover:bg-[var(--accent-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none'
              >
                {isGeneratingImages ? '이미지를 불러오는 중…' : '이미지 만들기'}
              </button>
              <button
                type='button'
                onClick={handleLoadLatest}
                disabled={isGeneratingImages || isLoadingLatest}
                className='rounded-2xl border border-white/70 px-5 py-3 text-sm font-semibold text-slate-700 shadow-inner transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isLoadingLatest ? '불러오는 중…' : '최근 기록 불러오기'}
              </button>
              <span className='text-xs text-slate-500'>여러 줄로 자유롭게 적어 주세요.</span>
            </div>
            {imageError ? <p className='text-sm font-semibold text-rose-500'>{imageError}</p> : null}
            {images.length ? (
              <p className='text-xs text-slate-500'>
                {usedReference ? '이번 결과에는 스케치 참고가 반영됐어요.' : '이번 결과는 텍스트만으로 만들어졌어요.'}
              </p>
            ) : null}
          </form>
        </section>

        <section className={`${panelClass} space-y-6`}>
          <div className='flex flex-wrap items-baseline justify-between gap-3'>
            <div>
              <p className='text-sm font-semibold text-pink-600'>스케치에서 탄생한 이미지 5장</p>
              <p className='text-sm text-slate-600'>마음에 드는 그림을 선택하면 아래 비디오에도 자동으로 연결돼요.</p>
            </div>
            {images.length ? (
              <span className='rounded-full bg-pink-100/70 px-3 py-1 text-xs font-semibold text-pink-600'>{images.length} 장</span>
            ) : null}
          </div>
          <ImageGrid images={images} selectedId={selectedImageId} onSelect={(image) => setSelectedImageId(image.id)} />
          {selectedImage ? (
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/50 px-4 py-3 text-sm text-slate-600'>
              <div>
                <p className='font-semibold text-slate-900'>{selectedImage.fileName}</p>
                <p className='text-xs text-slate-500'>모델 {selectedImage.model} · {selectedImage.size}</p>
              </div>
              <p className='text-xs font-semibold text-pink-500'>비디오 참조 이미지로 사용 중</p>
            </div>
          ) : (
            <p className='text-sm text-slate-500'>이미지를 만들면 선택한 카드 정보가 여기에 표시돼요.</p>
          )}
        </section>

        <section className='grid gap-6 lg:grid-cols-[1.05fr_0.95fr]'>
          <div className={`${panelClass} space-y-4`}>
            <div className='space-y-2'>
              <p className='text-sm font-semibold text-pink-600'>소라 비디오 아틀리에</p>
              <p className='text-sm text-slate-600'>선택한 이미지를 바탕으로 움직임, 카메라 워크, 분위기를 구체적으로 적어주세요.</p>
            </div>
            <textarea
              value={videoPrompt}
              onChange={(event) => setVideoPrompt(event.target.value)}
              rows={5}
              placeholder='예: 카메라가 오른쪽으로 천천히 이동하며 주인공을 따라가고, 풍선이 하늘로 날아가는 장면을 강조해줘.'
              className='rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-slate-800 shadow-inner focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30'
            />
            <div className='flex flex-wrap items-center gap-3'>
              <button
                type='button'
                onClick={handleGenerateVideo}
                disabled={!canGenerateVideo || isGeneratingVideo}
                className='rounded-2xl bg-[var(--accent-primary)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-200/60 transition hover:bg-[var(--accent-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isGeneratingVideo ? '소라에게 보내는 중…' : '비디오 만들기'}
              </button>
              {canLoadStoredVideo ? (
                <button
                  type='button'
                  onClick={handleLoadLatestVideo}
                  disabled={isGeneratingVideo}
                  className='rounded-2xl border border-white/70 px-5 py-3 text-sm font-semibold text-slate-700 shadow-inner transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60'
                >
                  마지막 비디오 불러오기
                </button>
              ) : null}
              <p className='text-xs text-slate-500'>목표 길이 8초 · 1280×720</p>
            </div>
            {videoError ? <p className='text-sm font-semibold text-rose-500'>{videoError}</p> : null}
          </div>
          <div className='glass-panel p-4 lg:p-6'>
            <VideoPlaceholder progress={progress} videoUrl={videoResult?.url ?? null} isGenerating={isGeneratingVideo || isPollingProgress} />
          </div>
        </section>
      </div>
    </div>
  )
}
