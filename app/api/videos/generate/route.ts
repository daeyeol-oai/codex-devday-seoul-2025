import path from 'path'
import { randomUUID } from 'node:crypto'
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
const VIDEO_DIRECTORY = 'videos'
const VIDEO_FILE_PREFIX = 'video'
const REFERENCE_FILE_NAME = 'reference.png'
const PROGRESS_FILE_PREFIX = 'sora-progress'
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 90

type VideoRequestBody = {
  prompt?: unknown
  imageUrl?: unknown
  seconds?: unknown
  size?: unknown
  runId?: unknown
  token?: unknown
}

type NormalizedRequest = {
  prompt: string
  runId: string
  imageRelativePath: string
  seconds: '4' | '8' | '12'
  size: '720x1280' | '1280x720' | '1024x1792' | '1792x1024'
  videoToken: string
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
  progressFile: string
  videoFile: string | null
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

type StoredVideoMetadata = {
  id: string
  fileName: string
  relativePath: string
  url: string
  progressFile: string
  seconds: string
  size: string
  prompt: string
  createdAt: string
  model: string
  videoJobId: string
}

async function prepareReferenceImage(runId: string, sourceRelativePath: string, targetSize: string, referenceRelativePath: string) {
  const [width, height] = targetSize.split('x').map((part) => Number.parseInt(part, 10))
  const sourcePath = resolveRunPath(runId, sourceRelativePath)
  const referenceRelative = referenceRelativePath
  const referencePath = resolveRunPath(runId, referenceRelative)
  await fs.mkdir(path.dirname(referencePath), { recursive: true })
  const buffer = await sharp(sourcePath).resize(width, height, { fit: 'cover' }).png().toBuffer()
  await fs.writeFile(referencePath, buffer)
  return referenceRelative
}

function initialProgressSnapshot(
  runId: string,
  prompt: string,
  videoId: string,
  request: NormalizedRequest,
  progressRelativePath: string,
  videoRelativePath: string,
  referenceRelativePath: string,
): ProgressSnapshot {
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
    progressFile: progressRelativePath,
    videoFile: null,
    history: [
      {
        status: 'queued',
        progress: 0,
        timestamp,
      },
    ],
    assets: {
      video: null,
      reference: `/outputs/${runId}/${referenceRelativePath}`,
      images: [`/outputs/${runId}/${request.imageRelativePath}`],
    },
  }
}

async function writeProgress(runId: string, relativePath: string, snapshot: ProgressSnapshot) {
  await writeFileInRun(runId, relativePath, JSON.stringify(snapshot, null, 2))
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

async function downloadVideo(runId: string, videoId: string, relativePath: string) {
  const client = getOpenAIClient()
  const response = await client.videos.downloadContent(videoId)
  const arrayBuffer = await response.arrayBuffer()
  await writeFileInRun(runId, relativePath, Buffer.from(arrayBuffer))
  return `/outputs/${runId}/${relativePath}`
}

function createVideoToken() {
  return randomUUID().split('-')[0]
}

function ensureVideoToken(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (trimmed.length >= 4 && trimmed.length <= 16) {
      return trimmed
    }
  }
  return createVideoToken()
}

function buildVideoPaths(videoToken: string) {
  const baseDir = path.posix.join(VIDEO_DIRECTORY, videoToken)
  const videoFileName = `${VIDEO_FILE_PREFIX}-${videoToken}.mp4`
  const progressFileName = `${PROGRESS_FILE_PREFIX}-${videoToken}.json`
  const videoRelativePath = path.posix.join(baseDir, videoFileName)
  const progressRelativePath = path.posix.join(baseDir, progressFileName)
  const referenceRelativePath = path.posix.join(baseDir, REFERENCE_FILE_NAME)
  return {
    videoRelativePath,
    progressRelativePath,
    referenceRelativePath,
  }
}

async function appendVideoMetadata(runId: string, payload: StoredVideoMetadata) {
  const metadataPath = resolveRunPath(runId, 'metadata.json')
  let parsed: Record<string, unknown> = {}
  try {
    const raw = await fs.readFile(metadataPath, 'utf8')
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  const existingVideos = Array.isArray((parsed as { videos?: unknown }).videos)
    ? ((parsed as { videos?: StoredVideoMetadata[] }).videos ?? [])
    : []
  const nextVideos = [...existingVideos.filter((entry) => entry.id !== payload.id), payload]

  const next = {
    ...parsed,
    videos: nextVideos,
  }

  await writeFileInRun(runId, 'metadata.json', JSON.stringify(next, null, 2))
}

function normalizeRequest(body: VideoRequestBody): NormalizedRequest {
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    throw new Error('Prompt is required')
  }
  if (typeof body.imageUrl !== 'string' || body.imageUrl.trim().length === 0) {
    throw new Error('imageUrl is required')
  }

  const record = body as Record<string, unknown>
  const { runSegment, imageRelativePath } = normalizeImagePath(body.imageUrl.trim())

  const runId = typeof body.runId === 'string' && body.runId.trim().length > 0
    ? sanitizePathSegment(body.runId, body.runId)
    : runSegment

  const videoToken = ensureVideoToken(record.token)

  return {
    prompt: body.prompt.trim(),
    runId,
    imageRelativePath,
    seconds: ensureSeconds(body.seconds),
    size: ensureSize(body.size),
    videoToken,
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

    const { videoRelativePath, progressRelativePath, referenceRelativePath } = buildVideoPaths(
      normalized.videoToken,
    )

    await prepareReferenceImage(
      normalized.runId,
      normalized.imageRelativePath,
      normalized.size,
      referenceRelativePath,
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

    const snapshot = initialProgressSnapshot(
      normalized.runId,
      normalized.prompt,
      videoJob.id,
      normalized,
      progressRelativePath,
      videoRelativePath,
      referenceRelativePath,
    )
    updateProgress(snapshot, videoJob.status, videoJob.progress ?? 0, videoJob.created_at)
    await writeProgress(normalized.runId, progressRelativePath, snapshot)

    let currentJob = videoJob
    let attempts = 0

    while (currentJob.status !== 'completed' && currentJob.status !== 'failed') {
      if (attempts >= MAX_POLL_ATTEMPTS) {
        updateProgress(snapshot, 'failed', snapshot.progress, Math.floor(Date.now() / 1000), {
          message: 'Video generation timed out',
        })
        await writeProgress(normalized.runId, progressRelativePath, snapshot)
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
        await writeProgress(normalized.runId, progressRelativePath, snapshot)
        return error(502, 'Video generation failed while polling for status', { code: 'poll_failed' })
      }

      updateProgress(
        snapshot,
        currentJob.status,
        currentJob.progress ?? snapshot.progress,
        Math.floor(Date.now() / 1000),
        currentJob.error ? { code: currentJob.error.code, message: currentJob.error.message } : undefined,
      )
      await writeProgress(normalized.runId, progressRelativePath, snapshot)
    }

    if (currentJob.status === 'failed') {
      const failureMessage = currentJob.error?.message ?? 'Video generation failed'
      await writeProgress(normalized.runId, progressRelativePath, snapshot)
      return error(502, failureMessage, { code: currentJob.error?.code })
    }

    const videoUrl = await downloadVideo(normalized.runId, currentJob.id, videoRelativePath)
    snapshot.assets.video = videoUrl
    snapshot.videoFile = videoRelativePath
    snapshot.progress = 100
    snapshot.status = 'completed'
    snapshot.updatedAt = new Date((currentJob.completed_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
    snapshot.history.push({
      status: 'completed',
      progress: 100,
      timestamp: snapshot.updatedAt,
    })
    await writeProgress(normalized.runId, progressRelativePath, snapshot)

    const storedAt = new Date().toISOString()
    await appendVideoMetadata(normalized.runId, {
      id: normalized.videoToken,
      fileName: path.posix.basename(videoRelativePath),
      relativePath: videoRelativePath,
      url: videoUrl,
      progressFile: progressRelativePath,
      seconds: normalized.seconds,
      size: normalized.size,
      prompt: normalized.prompt,
      createdAt: storedAt,
      model: VIDEO_MODEL,
      videoJobId: currentJob.id,
    })

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
          fileName: path.posix.basename(videoRelativePath),
          relativePath: videoRelativePath,
          token: normalized.videoToken,
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
