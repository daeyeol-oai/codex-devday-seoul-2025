'use client'

import { useMemo, useState } from 'react'

import { GeneratedGallery } from '@/components/GeneratedGallery'
import { UploadControls } from '@/components/UploadControls'
import { VideoPreview } from '@/components/VideoPreview'
import { VideoRequestForm } from '@/components/VideoRequestForm'
import type { GeneratedImage } from '@/types/media'

const ROBOT_COLORS: Array<Pick<GeneratedImage, 'backgroundColor' | 'accentColor'>> =
  [
    { backgroundColor: '#f2d6a0', accentColor: '#d68c45' },
    { backgroundColor: '#f4dfbc', accentColor: '#e0a937' },
    { backgroundColor: '#d8e8e8', accentColor: '#5ca8b5' },
    { backgroundColor: '#f1e0c5', accentColor: '#4d9db8' },
    { backgroundColor: '#f3ddbe', accentColor: '#e78b2f' },
  ]

const ROBOT_TITLES = [
  'Quiet companion',
  'Curious explorer',
  'Sketch helper',
  'Story sidekick',
  'Bright inventor',
]

function createMockImages(): GeneratedImage[] {
  const timestamp = Date.now()
  return ROBOT_COLORS.map((colors, index) => ({
    id: `image-${timestamp}-${index}`,
    title: ROBOT_TITLES[index % ROBOT_TITLES.length],
    description: 'A playful robot rendition generated from the latest prompt.',
    ...colors,
  }))
}

export default function Home() {
  const [fileName, setFileName] = useState<string>()
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState<GeneratedImage[]>(() => createMockImages())
  const [selectedImageId, setSelectedImageId] = useState<string | null>(
    images[0]?.id ?? null,
  )
  const [videoDescription, setVideoDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [videoMessage, setVideoMessage] = useState<string>()

  const selectedImageTitle = useMemo(() => {
    return images.find((image) => image.id === selectedImageId)?.title ?? null
  }, [images, selectedImageId])

  const triggerMockGeneration = () => {
    setIsGenerating(true)
    setTimeout(() => {
      const nextImages = createMockImages()
      setImages(nextImages)
      setSelectedImageId(nextImages[0]?.id ?? null)
      setIsGenerating(false)
    }, 700)
  }

  const triggerLoadLatest = () => {
    setIsGenerating(true)
    setTimeout(() => {
      const nextImages = createMockImages()
      setImages(nextImages)
      setSelectedImageId(nextImages[0]?.id ?? null)
      setIsGenerating(false)
    }, 500)
  }

  const handleVideoSubmit = () => {
    setIsSubmitting(true)
    setVideoMessage('Submitting your prompt to Sora…')
    setTimeout(() => {
      setIsSubmitting(false)
      setVideoMessage('Video request received. Preview will appear when ready.')
    }, 1000)
  }

  return (
    <div className='flex min-h-screen bg-zinc-100 text-zinc-900 dark:bg-black dark:text-zinc-50'>
      <main className='mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 md:px-16'>
        <header className='space-y-3'>
          <p className='text-xs font-semibold uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-500'>
            Builder
          </p>
          <h1 className='text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50'>
            Building Stories
          </h1>
          <p className='max-w-2xl text-sm text-zinc-500 dark:text-zinc-400'>
            Create a sequence of illustrations from your sketches, then craft a
            final video powered by Sora.
          </p>
        </header>

        <UploadControls
          fileName={fileName}
          prompt={prompt}
          onFileChange={(file) => setFileName(file?.name)}
          onPromptChange={setPrompt}
          onGenerateImages={triggerMockGeneration}
          onLoadLatest={triggerLoadLatest}
          isGenerating={isGenerating}
        />

        <div className='space-y-4'>
          <GeneratedGallery
            images={images}
            selectedId={selectedImageId}
            onSelect={setSelectedImageId}
          />
          {selectedImageTitle ? (
            <p className='text-sm text-zinc-600 dark:text-zinc-400'>
              Selected image: {selectedImageTitle}
            </p>
          ) : null}
        </div>

        <VideoRequestForm
          description={videoDescription}
          onDescriptionChange={setVideoDescription}
          onSubmit={handleVideoSubmit}
          isSubmitting={isSubmitting}
        />

        <VideoPreview message={videoMessage} />
      </main>

      <aside className='hidden w-20 items-center justify-center bg-black text-white md:flex'>
        <span className='-rotate-90 text-xs font-semibold tracking-[0.4em]'>
          Builder
        </span>
      </aside>
    </div>
  )
}
