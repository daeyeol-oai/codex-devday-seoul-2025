'use client'

import { useMemo } from 'react'

import type { VideoProgressSnapshot } from '@/types/media'

type VideoPlaceholderProps = {
  progress: VideoProgressSnapshot | null
  videoUrl: string | null
  isGenerating: boolean
}

export function VideoPlaceholder({ progress, videoUrl, isGenerating }: VideoPlaceholderProps) {
  const latest = useMemo(() => {
    if (!progress) return null
    return progress.history.at(-1)
  }, [progress])

  if (videoUrl) {
    return (
      <div className='overflow-hidden rounded-xl border border-zinc-200 bg-black shadow-sm'>
        <video
          src={videoUrl}
          controls
          className='h-72 w-full bg-black'
        />
        <div className='border-t border-zinc-800/40 bg-zinc-900 px-4 py-3 text-sm text-zinc-200'>
          <p className='font-semibold'>Video ready</p>
          <p className='text-xs text-zinc-400'>Stored at {videoUrl}</p>
        </div>
      </div>
    )
  }

  if (isGenerating) {
    return (
      <div className='flex h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white text-center'>
        <div className='flex items-center gap-2 text-sm font-medium text-zinc-700'>
          <span className='h-2 w-2 animate-pulse rounded-full bg-blue-500' />
          Rendering video with Sora…
        </div>
        {latest ? (
          <div className='text-xs text-zinc-500'>
            <p>Status: {latest.status}</p>
            <p>Progress: {latest.progress}%</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white text-center text-sm text-zinc-500'>
      <p>No video yet. Select an image and request a video.</p>
    </div>
  )
}
