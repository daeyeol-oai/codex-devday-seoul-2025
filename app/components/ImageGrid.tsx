'use client'

import Image from 'next/image'

import type { GeneratedImage } from '@/types/media'

type ImageGridProps = {
  images: GeneratedImage[]
  selectedId: string | null
  onSelect: (image: GeneratedImage) => void
}

export function ImageGrid({ images, selectedId, onSelect }: ImageGridProps) {
  if (!images.length) {
    return (
      <div className='rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500'>
        Upload a sketch and prompt to generate images.
      </div>
    )
  }

  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'>
      {images.map((image) => {
        const isSelected = image.id === selectedId
        return (
          <button
            key={image.id}
            type='button'
            onClick={() => onSelect(image)}
            className={`group relative overflow-hidden rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              isSelected
                ? 'border-blue-500 ring-2 ring-blue-500'
                : 'border-zinc-200 hover:border-blue-400'
            }`}
          >
            <Image
              src={image.url}
              alt={image.fileName}
              width={image.width ?? 512}
              height={image.height ?? 768}
              className='h-48 w-full object-cover'
              unoptimized
            />
            <div className='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-left text-xs text-white'>
              <p className='font-semibold'>{image.fileName}</p>
              <p className='opacity-80'>Model: {image.model}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
