'use client'

type VideoPreviewProps = {
  src?: string | null
  poster?: string
  message?: string
}

export function VideoPreview({ src, poster, message }: VideoPreviewProps) {
  return (
    <section className='w-full rounded-lg border border-zinc-200 bg-black/90 p-4 shadow-inner dark:border-zinc-700'>
      {src ? (
        <video
          controls
          src={src}
          poster={poster}
          className='h-48 w-full rounded-md bg-black'
        >
          Your browser does not support the video tag.
        </video>
      ) : (
        <div className='flex h-48 w-full items-center justify-center rounded-md border border-dashed border-zinc-600 bg-black text-sm text-zinc-300'>
          {message ?? 'Video preview will appear here after generation.'}
        </div>
      )}
    </section>
  )
}
