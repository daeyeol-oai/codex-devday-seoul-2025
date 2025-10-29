import path from 'path'
import { promises as fs } from 'fs'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { toFile } from 'openai'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import {
  ensureRunDirectory,
  resolveRunPath,
  sanitizePathSegment,
  writeFileInRun,
} from '@/lib/server/storage'
import { logError, logInfo } from '@/lib/server/logger'
import { getOpenAIClient } from '@/lib/server/openai'

export const runtime = 'nodejs'

const VIDEO_MODEL = 'sora-2'
const DEFAULT_SECONDS = '8' as const
const DEFAULT_SIZE = '1280x720' as const
const PROGRESS_FILE = 'progress.json'
const REFERENCE_FILE = 'video/reference.png'
const OUTPUT_VIDEO_FILE = 'video.mp4'
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 90

type VideoRequestBody = {
  prompt?: unknown
  imageUrl?: unknown
  seconds?: unknown
  size?: unknown
  runId?: unknown
}

type NormalizedRequest = {
  prompt: string
  runId: string
  imageRelativePath: string
  seconds: '4' | '8' | '12'
  size: '720x1280' | '1280x720' | '1024x1792' | '1792x1024'
}

type ProgressSnapshot = {
  runId: string
  prompt: string
  model: string
  videoId: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number
  seconds: string
  size: string
  startedAt: string
  updatedAt: string
  history: Array<{
    status: 'queued' | 'in_progress' | 'completed' | 'failed'
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

function ensureSeconds(value: unknown): '4' | '8' | '12' {
  const allowed: Array<'4' | '8' | '12'> = ['4', '8', '12']
  const asString = typeof value === 'number' ? value.toString() : typeof value === 'string' ? value : null
  if (asString && allowed.includes(asString as '4' | '8' | '12')) {
    return asString as '4' | '8' | '12'
  }
  return DEFAULT_SECONDS
}

function ensureSize(value: unknown): '720x1280' | '1280x720' | '1024x1792' | '1792x1024' {
  const allowed = new Set(['720x1280', '1280x720', '1024x1792', '1792x1024'])
  if (typeof value === 'string' && allowed.has(value)) {
    return value as '720x1280' | '1280x720' | '1024x1792' | '1792x1024'
  }
  return DEFAULT_SIZE
}

function normalizeImagePath(imageUrl: string) {
  const trimmed = imageUrl.replace(/^\/+/, '')
  if (!trimmed.startsWith('outputs/')) {
    throw new Error('imageUrl must reference a local /outputs/ asset')
  }
  const relative = trimmed.slice('outputs/'.length)
  const segments = relative.split('/')
  if (segments.length < 2) {
    throw new Error('imageUrl must include run scope and file path')
  }
  const runSegment = sanitizePathSegment(segments[0], segments[0])
  const imageRelativePath = segments.slice(1).join('/')
  return { runSegment, imageRelativePath }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fileExists(pathToFile: string) {
  try {
    const stats = await fs.stat(pathToFile)
    return stats.isFile()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

async function prepareReferenceImage(runId: string, sourceRelativePath: string, targetSize: string) {
  const [width, height] = targetSize.split('x').map((part) => Number.parseInt(part, 10))
  const sourcePath = resolveRunPath(runId, sourceRelativePath)
  const referenceRelative = REFERENCE_FILE
  const referencePath = resolveRunPath(runId, referenceRelative)
  await fs.mkdir(path.dirname(referencePath), { recursive: true })
  const buffer = await sharp(sourcePath).resize(width, height, { fit: 'cover' }).png().toBuffer()
  await fs.writeFile(referencePath, buffer)
  return referenceRelative
}

function initialProgressSnapshot(runId: string, prompt: string, videoId: string, request: NormalizedRequest): ProgressSnapshot {
  const timestamp = new Date().toISOString()
  return {
    runId,
    prompt,
    model: VIDEO_MODEL,
    videoId,
    status: 'queued',
    progress: 0,
    seconds: request.seconds,
    size: request.size,
    startedAt: timestamp,
    updatedAt: timestamp,
    history: [
      {
        status: 'queued',
        progress: 0,
        timestamp,
      },
    ],
    assets: {
      video: null,
      reference: `/outputs/${runId}/${REFERENCE_FILE}`,
      images: [`/outputs/${runId}/${request.imageRelativePath}`],
    },
  }
}

async function writeProgress(runId: string, snapshot: ProgressSnapshot) {
  await writeFileInRun(runId, PROGRESS_FILE, JSON.stringify(snapshot, null, 2))
}

function updateProgress(snapshot: ProgressSnapshot, status: ProgressSnapshot['status'], progressValue: number, updatedAt: number, error?: { code?: string; message?: string }) {
  const timestamp = new Date(updatedAt * 1000 || Date.now()).toISOString()
  snapshot.status = status
  snapshot.progress = progressValue
  snapshot.updatedAt = timestamp
  snapshot.history.push({ status, progress: progressValue, timestamp })
  if (error) {
    snapshot.error = error
  }
}

async function downloadVideo(runId: string, videoId: string) {
  const client = getOpenAIClient()
  const response = await client.videos.downloadContent(videoId)
  const arrayBuffer = await response.arrayBuffer()
  await writeFileInRun(runId, OUTPUT_VIDEO_FILE, Buffer.from(arrayBuffer))
  return `/outputs/${runId}/${OUTPUT_VIDEO_FILE}`
}

function normalizeRequest(body: VideoRequestBody): NormalizedRequest {
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    throw new Error('Prompt is required')
  }
  if (typeof body.imageUrl !== 'string' || body.imageUrl.trim().length === 0) {
    throw new Error('imageUrl is required')
  }

  const { runSegment, imageRelativePath } = normalizeImagePath(body.imageUrl.trim())

  const runId = typeof body.runId === 'string' && body.runId.trim().length > 0
    ? sanitizePathSegment(body.runId, body.runId)
    : runSegment

  return {
    prompt: body.prompt.trim(),
    runId,
    imageRelativePath,
    seconds: ensureSeconds(body.seconds),
    size: ensureSize(body.size),
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VideoRequestBody
    const normalized = normalizeRequest(body)

    await ensureRunDirectory(normalized.runId)

    const sourcePath = resolveRunPath(normalized.runId, normalized.imageRelativePath)
    if (!(await fileExists(sourcePath))) {
      return error(400, 'Referenced image file does not exist')
    }

    const referenceRelativePath = await prepareReferenceImage(
      normalized.runId,
      normalized.imageRelativePath,
      normalized.size,
    )

    const referenceAbsolutePath = resolveRunPath(normalized.runId, referenceRelativePath)
    const referenceBuffer = await fs.readFile(referenceAbsolutePath)
    const referenceFile = await toFile(referenceBuffer, 'reference.png', { type: 'image/png' })

    const client = getOpenAIClient()
    let videoJob
    try {
      videoJob = await client.videos.create({
        model: VIDEO_MODEL,
        prompt: normalized.prompt,
        seconds: normalized.seconds,
        size: normalized.size,
        input_reference: referenceFile,
      })
    } catch (apiError) {
      logError('Sora video creation failed', apiError, { runId: normalized.runId })
      return error(502, 'Video generation request failed')
    }

    const snapshot = initialProgressSnapshot(normalized.runId, normalized.prompt, videoJob.id, normalized)
    updateProgress(snapshot, videoJob.status, videoJob.progress ?? 0, videoJob.created_at)
    await writeProgress(normalized.runId, snapshot)

    let currentJob = videoJob
    let attempts = 0

    while (currentJob.status !== 'completed' && currentJob.status !== 'failed') {
      if (attempts >= MAX_POLL_ATTEMPTS) {
        updateProgress(snapshot, 'failed', snapshot.progress, Math.floor(Date.now() / 1000), {
          message: 'Video generation timed out',
        })
        await writeProgress(normalized.runId, snapshot)
        return error(504, 'Video generation timed out')
      }

      await delay(POLL_INTERVAL_MS)
      attempts += 1

      try {
        currentJob = await client.videos.retrieve(videoJob.id)
      } catch (pollError) {
        logError('Failed to poll video status', pollError, { videoId: videoJob.id })
        updateProgress(snapshot, 'failed', snapshot.progress, Math.floor(Date.now() / 1000), {
          code: 'poll_failed',
          message: pollError instanceof Error ? pollError.message : 'Failed to poll video status',
        })
        await writeProgress(normalized.runId, snapshot)
        return error(502, 'Video generation failed while polling for status', { code: 'poll_failed' })
      }

      updateProgress(
        snapshot,
        currentJob.status,
        currentJob.progress ?? snapshot.progress,
        Math.floor(Date.now() / 1000),
        currentJob.error ? { code: currentJob.error.code, message: currentJob.error.message } : undefined,
      )
      await writeProgress(normalized.runId, snapshot)
    }

    if (currentJob.status === 'failed') {
      const failureMessage = currentJob.error?.message ?? 'Video generation failed'
      await writeProgress(normalized.runId, snapshot)
      return error(502, failureMessage, { code: currentJob.error?.code })
    }

    const videoUrl = await downloadVideo(normalized.runId, currentJob.id)
    snapshot.assets.video = videoUrl
    snapshot.progress = 100
    snapshot.status = 'completed'
    snapshot.updatedAt = new Date((currentJob.completed_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
    snapshot.history.push({
      status: 'completed',
      progress: 100,
      timestamp: snapshot.updatedAt,
    })
    await writeProgress(normalized.runId, snapshot)

    await writeFileInRun(normalized.runId, 'video.json', JSON.stringify(currentJob, null, 2))

    logInfo('Sora video generated successfully', {
      runId: normalized.runId,
      videoId: currentJob.id,
      size: normalized.size,
      seconds: normalized.seconds,
    })

    return json(
      {
        runId: normalized.runId,
        prompt: normalized.prompt,
        seconds: normalized.seconds,
        size: normalized.size,
        video: {
          url: videoUrl,
          fileName: OUTPUT_VIDEO_FILE,
          id: currentJob.id,
        },
        progress: snapshot,
      },
      { status: 201 },
    )
  } catch (err) {
    logError('Failed to process video generation request', err)
    return error(500, err instanceof Error ? err.message : 'Failed to process video request')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
