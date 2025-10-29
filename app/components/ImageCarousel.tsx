'use client'

import Image from 'next/image'
import { useMemo } from 'react'

import type { GeneratedImage } from '@/types/media'

type ImageCarouselProps = {
  images: GeneratedImage[]
  selectedId: string | null
  onSelect: (image: GeneratedImage) => void
}

export function ImageCarousel({ images, selectedId, onSelect }: ImageCarouselProps) {
  const currentIndex = useMemo(() => {
    if (!images.length) return -1
    const index = images.findIndex((image) => image.id === selectedId)
    return index >= 0 ? index : 0
  }, [images, selectedId])

  if (!images.length) {
    return null
  }

  const currentImage = images[currentIndex]

  const goToIndex = (nextIndex: number) => {
    const wrapped = (nextIndex + images.length) % images.length
    onSelect(images[wrapped])
  }

  return (
    <div className='relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50'>
      <div className='relative h-[420px] w-full sm:h-[520px]'>
        <Image
          key={currentImage.id}
          src={currentImage.url}
          alt={`Generated image ${currentImage.fileName}`}
          fill
          className='object-contain'
          sizes='(min-width: 1024px) 640px, 100vw'
          priority
          unoptimized
        />
      </div>
      <div className='absolute inset-y-0 left-0 flex items-center p-4'>
        <button
          type='button'
          onClick={() => goToIndex(currentIndex - 1)}
          className='rounded-full bg-white/80 p-2 text-xs font-semibold shadow hover:bg-white'
        >
          Prev
        </button>
      </div>
      <div className='absolute inset-y-0 right-0 flex items-center p-4'>
        <button
          type='button'
          onClick={() => goToIndex(currentIndex + 1)}
          className='rounded-full bg-white/80 p-2 text-xs font-semibold shadow hover:bg-white'
        >
          Next
        </button>
      </div>
      <div className='border-t border-zinc-200 bg-white/90 px-4 py-3 text-sm text-zinc-600 backdrop-blur'>
        <div className='flex items-center justify-between'>
          <div>
            <p className='font-medium text-zinc-900'>{currentImage.fileName}</p>
            <p className='text-xs text-zinc-500'>Model: {currentImage.model}</p>
          </div>
          <div className='text-xs text-zinc-500'>
            {currentIndex + 1} / {images.length}
          </div>
        </div>
      </div>
    </div>
  )
}
