'use client'

import { GeneratedImage } from '@/types/media'

type GeneratedGalleryProps = {
  images: GeneratedImage[]
  selectedId?: string | null
  onSelect: (id: string) => void
}

export function GeneratedGallery({
  images,
  selectedId,
  onSelect,
}: GeneratedGalleryProps) {
  if (!images.length) {
    return (
      <section
        aria-label='Generated images'
        className='w-full rounded-lg border border-dashed border-zinc-300 bg-white/60 p-8 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300'
      >
        No images yet. Generate a set to get started.
      </section>
    )
  }

  return (
    <section className='w-full'>
      <div className='mb-3 flex items-center gap-2'>
        <h2 className='text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300'>
          Generated images
        </h2>
        <span className='rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'>
          {images.length}
        </span>
      </div>
      <div className='flex flex-wrap gap-3'>
        {images.map((image) => {
          const isSelected = image.id === selectedId
          return (
            <button
              key={image.id}
              type='button'
              onClick={() => onSelect(image.id)}
              aria-pressed={isSelected}
              className={`group relative flex h-52 w-36 flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 dark:bg-zinc-900 ${
                isSelected
                  ? 'border-zinc-800 ring-2 ring-zinc-800 dark:border-zinc-100'
                  : 'border-transparent hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-700/40'
              }`}
            >
              <div
                className='flex flex-1 items-center justify-center'
                style={{
                  backgroundColor: image.backgroundColor,
                }}
              >
                <span
                  className='inline-flex h-24 w-20 items-center justify-center rounded-md text-lg font-semibold text-white'
                  style={{ backgroundColor: image.accentColor }}
                >
                  🤖
                </span>
              </div>
              <div className='border-t border-zinc-200 px-3 py-2 text-left text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'>
                <p className='font-medium text-zinc-800 dark:text-zinc-100'>
                  {image.title}
                </p>
                <p className='text-[11px] text-zinc-500 dark:text-zinc-400'>
                  {image.description}
                </p>
              </div>
              {isSelected ? (
                <span className='absolute inset-1 rounded-md border-2 border-zinc-800/80 ring-2 ring-zinc-800/50 dark:border-zinc-100/80 dark:ring-zinc-100/40' />
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
