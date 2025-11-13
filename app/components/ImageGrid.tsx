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
      <div className='rounded-2xl border border-dashed border-white/60 bg-white/40 p-8 text-center text-sm text-slate-500'>
        스케치와 프롬프트를 올리면 다섯 장의 이미지가 여기에 나타납니다.
      </div>
    )
  }

  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5'>
      {images.map((image) => {
        const isSelected = image.id === selectedId
        return (
          <button
            key={image.id}
            type='button'
            onClick={() => onSelect(image)}
            aria-pressed={isSelected}
            className={`group relative overflow-hidden rounded-2xl border-2 bg-white/60 text-left shadow-sm transition focus:outline-none focus-visible:ring-4 focus-visible:ring-pink-200/60 ${
              isSelected
                ? 'border-[var(--accent-primary)] shadow-lg shadow-pink-200/70'
                : 'border-transparent hover:border-white'
            }`}
          >
            <Image
              src={image.url}
              alt={image.fileName}
              width={image.width ?? 512}
              height={image.height ?? 768}
              className='h-40 w-full object-cover'
              unoptimized
            />
            <div className='absolute inset-x-2 bottom-2 rounded-xl bg-slate-900/80 px-3 py-2 text-left text-[11px] text-white shadow-lg shadow-slate-900/40'>
              <p className='font-semibold'>{image.fileName}</p>
              <p className='opacity-80'>모델 {image.model}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
