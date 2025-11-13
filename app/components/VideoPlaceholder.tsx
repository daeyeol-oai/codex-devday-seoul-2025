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
      <div className='flex h-full flex-col gap-4'>
        <div className='overflow-hidden rounded-3xl border border-slate-900/60 bg-slate-950 shadow-inner'>
          <video src={videoUrl} controls className='aspect-video w-full bg-black object-cover' />
        </div>
        <div className='rounded-2xl border border-white/40 bg-white/60 px-4 py-3 text-sm text-slate-600'>
          <p className='font-semibold text-slate-900'>비디오 준비 완료</p>
          <p className='text-xs text-slate-500'>저장 위치: {videoUrl}</p>
        </div>
      </div>
    )
  }

  if (isGenerating) {
    return (
      <div className='flex h-72 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/60 bg-white/60 text-center text-sm text-slate-600'>
        <div className='flex items-center gap-2 font-semibold text-pink-600'>
          <span className='h-2 w-2 animate-pulse rounded-full bg-[var(--accent-primary)]' />
          소라가 영상을 그리는 중…
        </div>
        {latest ? (
          <div className='text-xs text-slate-500'>
            <p>상태: {latest.status}</p>
            <p>진행률: {latest.progress}%</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-white/60 bg-white/60 text-center text-sm text-slate-500'>
      <p>아직 비디오가 없습니다. 이미지를 선택하고 안내 문장을 적어 비디오를 요청해보세요.</p>
    </div>
  )
}
