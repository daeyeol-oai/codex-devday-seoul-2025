export type GeneratedImage = {
  id: string
  fileName: string
  url: string
  width?: number
  height?: number
  createdAt: string
  model: string
  size: string
}

export type ImageGenerationResponse = {
  runId: string
  createdAt: string
  prompt: string
  sketch?: {
    fileName: string
    url: string | null
  } | null
  images: GeneratedImage[]
  model: string
  usedReference: boolean
}

export type LatestAssetsResponse = {
  runId: string
  images: Array<{
    fileName: string
    url: string
    relativePath: string
    updatedAt: string
  }>
  video: {
    fileName: string
    url: string
    relativePath: string
    updatedAt: string
  } | null
  progress?: Record<string, unknown> | null
  metadata?: {
    prompt?: string
    usedReference?: boolean
  } | null
}

export type VideoProgressStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

export type VideoProgressSnapshot = {
  runId: string
  prompt: string
  model: string
  videoId: string
  status: VideoProgressStatus
  progress: number
  seconds: string
  size: string
  startedAt: string
  updatedAt: string
  history: Array<{
    status: VideoProgressStatus
    progress: number
    timestamp: string
  }>
  assets: {
    video: string | null
    reference: string
    images: string[]
  }
  error?: {
    code?: string
    message: string
  }
}

export type VideoGenerationResponse = {
  runId: string
  prompt: string
  seconds: string
  size: string
  video: {
    url: string
    fileName: string
    id: string
  }
  progress: VideoProgressSnapshot
}
