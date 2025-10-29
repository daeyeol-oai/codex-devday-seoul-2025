'use client'

type VideoRequestFormProps = {
  description: string
  onDescriptionChange: (value: string) => void
  onSubmit: () => void
  isSubmitting?: boolean
}

export function VideoRequestForm({
  description,
  onDescriptionChange,
  onSubmit,
  isSubmitting = false,
}: VideoRequestFormProps) {
  return (
    <div className='w-full space-y-3'>
      <label className='block text-sm font-medium text-zinc-600 dark:text-zinc-300'>
        Describe the final video (optional)
      </label>
      <textarea
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        rows={3}
        placeholder='Describe the final video (optional)'
        className='w-full resize-none rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-800 focus:ring-2 focus:ring-zinc-800/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200'
      />
      <button
        type='button'
        onClick={onSubmit}
        disabled={isSubmitting}
        className='rounded-md bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
      >
        {isSubmitting ? 'Creating…' : 'Create video with Sora'}
      </button>
    </div>
  )
}
