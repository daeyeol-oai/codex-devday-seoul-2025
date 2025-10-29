import path from 'path'
import { promises as fs } from 'fs'
import { NextRequest } from 'next/server'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import {
  createRunId,
  ensureRunDirectory,
  resolveRunPath,
  sanitizePathSegment,
  writeFileInRun,
} from '@/lib/server/storage'
import { logError, logInfo } from '@/lib/server/logger'
import { ensureOpenAIConfigured } from '@/lib/server/openai'

export const runtime = 'nodejs'

const PLACEHOLDER_VIDEO = path.join(process.cwd(), 'public', 'mock', 'video-placeholder.mp4')
const DEFAULT_SIZE = '720x1280'
const DEFAULT_SECONDS = 8

type VideoRequestBody = {
  prompt: unknown
  runId?: unknown
  imagePaths?: unknown
  seconds?: unknown
  size?: unknown
}

type NormalizedImageReference = {
  relativePath: string
  absolutePath: string
}

type ProgressStep = {
  status: 'queued' | 'processing' | 'completed'
  progress: number
  message: string
  timestamp: string
}

type ProgressSnapshot = {
  runId: string
  prompt: string
  status: 'completed'
  progress: number
  seconds: number
  size: string
  startedAt: string
  updatedAt: string
  steps: ProgressStep[]
  assets: {
    video: string
    images: string[]
  }
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function toString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeRelativePath(value: string) {
  let normalized = value.replace(/^\/+/, '').replace(/\\/g, '/')
  if (normalized.startsWith('outputs/')) {
    normalized = normalized.slice('outputs/'.length)
  }
  return normalized
}

async function ensureFileExists(pathToFile: string) {
  try {
    const stats = await fs.stat(pathToFile)
    if (!stats.isFile()) {
      throw new Error(`Expected file at ${pathToFile}`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found at ${pathToFile}`)
    }
    throw err
  }
}

async function resolveImagePaths(runId: string, imagePaths: unknown): Promise<NormalizedImageReference[]> {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('imagePaths must contain at least one entry')
  }

  return Promise.all(
    imagePaths.map(async (entry) => {
      if (typeof entry !== 'string') {
        throw new Error('imagePaths must be strings')
      }

      const normalized = normalizeRelativePath(entry)
      if (!normalized.startsWith(`${runId}/`)) {
        throw new Error(`Image path must be scoped to run ${runId}`)
      }

      const relativePath = normalized.slice(runId.length + 1)
      const absolutePath = resolveRunPath(runId, relativePath)
      await ensureFileExists(absolutePath)

      return {
        relativePath,
        absolutePath,
      }
    }),
  )
}

function buildProgressSteps(base: Date): ProgressStep[] {
  const offsets = [
    { status: 'queued' as const, progress: 5, message: 'Queued Sora render job', delta: 0 },
    {
      status: 'processing' as const,
      progress: 45,
      message: 'Synthesizing keyframes',
      delta: 2000,
    },
    {
      status: 'processing' as const,
      progress: 80,
      message: 'Compositing final sequence',
      delta: 4000,
    },
    {
      status: 'completed' as const,
      progress: 100,
      message: 'Video ready for preview',
      delta: 6000,
    },
  ]

  return offsets.map((step) => ({
    status: step.status,
    progress: step.progress,
    message: step.message,
    timestamp: new Date(base.getTime() + step.delta).toISOString(),
  }))
}

async function copyPlaceholderVideo(runId: string) {
  await ensureFileExists(PLACEHOLDER_VIDEO)
  const targetPath = resolveRunPath(runId, 'video.mp4')
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(PLACEHOLDER_VIDEO, targetPath)
  return targetPath
}

function buildVideoUrl(runId: string) {
  return `/outputs/${runId}/video.mp4`
}

function buildImageUrls(runId: string, references: NormalizedImageReference[]) {
  return references.map((ref) => `/outputs/${runId}/${ref.relativePath}`)
}

function determineRunId(bodyRunId: unknown, imagePaths: unknown): string {
  if (typeof bodyRunId === 'string' && bodyRunId.trim().length > 0) {
    return sanitizePathSegment(bodyRunId, bodyRunId)
  }

  if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    const first = imagePaths[0]
    if (typeof first === 'string' && first.trim().length > 0) {
      const normalized = normalizeRelativePath(first)
      const [candidate] = normalized.split('/')
      if (candidate) {
        return sanitizePathSegment(candidate, candidate)
      }
    }
  }

  return createRunId('video')
}

async function ensureRunContext(runId: string) {
  try {
    await ensureRunDirectory(runId)
  } catch (err) {
    logError('Failed to prepare run directory', err, { runId })
    throw err
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureOpenAIConfigured()
    const body = (await request.json()) as VideoRequestBody
    const prompt = toString(body.prompt).trim()

    if (!prompt) {
      return error(400, 'Prompt is required')
    }

    const seconds = toNumber(body.seconds, DEFAULT_SECONDS)
    const size = toString(body.size).trim() || DEFAULT_SIZE
    const runId = determineRunId(body.runId, body.imagePaths)

    await ensureRunContext(runId)
    let imageReferences: NormalizedImageReference[]
    try {
      imageReferences = await resolveImagePaths(runId, body.imagePaths)
    } catch (validationError) {
      const message =
        validationError instanceof Error ? validationError.message : 'Invalid image paths'
      logError('Invalid image references for video request', validationError, { runId })
      return error(400, message)
    }

    const videoPath = await copyPlaceholderVideo(runId)
    const startedAt = new Date()
    const steps = buildProgressSteps(startedAt)
    const progress: ProgressSnapshot = {
      runId,
      prompt,
      status: 'completed',
      progress: 100,
      seconds,
      size,
      startedAt: steps[0].timestamp,
      updatedAt: steps[steps.length - 1].timestamp,
      steps,
      assets: {
        video: buildVideoUrl(runId),
        images: buildImageUrls(runId, imageReferences),
      },
    }

    await writeFileInRun(runId, 'progress.json', JSON.stringify(progress, null, 2))

    logInfo('Video request mocked successfully', { runId, seconds, size })

    return json(
      {
        runId,
        prompt,
        seconds,
        size,
        video: {
          url: buildVideoUrl(runId),
          fileName: path.basename(videoPath),
        },
        progress,
      },
      { status: 201 },
    )
  } catch (err) {
    logError('Failed to process video request', err)
    return error(500, err instanceof Error ? err.message : 'Failed to submit video request')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
