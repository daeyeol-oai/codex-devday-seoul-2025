'use client'

import { ChangeEvent, FormEvent } from 'react'

type UploadControlsProps = {
  fileName?: string
  prompt: string
  onFileChange: (file: File | null) => void
  onPromptChange: (value: string) => void
  onGenerateImages: () => void
  onLoadLatest: () => void
  isGenerating?: boolean
}

export function UploadControls({
  fileName,
  prompt,
  onFileChange,
  onPromptChange,
  onGenerateImages,
  onLoadLatest,
  isGenerating = false,
}: UploadControlsProps) {
  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    onFileChange(file ?? null)
  }

  const handlePromptInput = (event: ChangeEvent<HTMLInputElement>) => {
    onPromptChange(event.target.value)
  }

  const handleGenerate = (event: FormEvent) => {
    event.preventDefault()
    onGenerateImages()
  }

  return (
    <form
      onSubmit={handleGenerate}
      className='flex w-full flex-col gap-4 md:flex-row md:items-center'
    >
      <label className='flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm hover:border-zinc-400 focus-within:border-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500'>
        <input
          type='file'
          className='hidden'
          onChange={handleFileInput}
          aria-label='Upload reference sketch'
        />
        <span>Choose File</span>
        <span className='truncate text-xs text-zinc-500 dark:text-zinc-300'>
          {fileName ?? 'No file chosen'}
        </span>
      </label>
      <input
        type='text'
        value={prompt}
        onChange={handlePromptInput}
        placeholder='Describe your sketch...'
        aria-label='Describe your sketch'
        className='flex-1 rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-800 focus:ring-2 focus:ring-zinc-800/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200'
      />
      <button
        type='submit'
        className='rounded-md bg-zinc-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-zinc-500 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
        disabled={isGenerating}
      >
        {isGenerating ? 'Generating…' : 'Generate 5 images'}
      </button>
      <button
        type='button'
        onClick={onLoadLatest}
        disabled={isGenerating}
        className='rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:disabled:border-zinc-700 dark:disabled:text-zinc-500'
      >
        Load latest
      </button>
    </form>
  )
}
