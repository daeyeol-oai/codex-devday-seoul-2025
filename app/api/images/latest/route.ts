import path from 'path'
import { promises as fs } from 'fs'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import {
  getOutputsRoot,
  listRuns,
  resolveRunPath,
  sanitizePathSegment,
} from '@/lib/server/storage'
import { logError, logInfo } from '@/lib/server/logger'

export const runtime = 'nodejs'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])
const SORA_PROGRESS_PREFIX = 'sora-progress'

type AssetDescriptor = {
  fileName: string
  url: string
  relativePath: string
  updatedAt: string
}

type VideoMetadataEntry = {
  id?: string
  relativePath?: string
  progressFile?: string
  fileName?: string
  url?: string
  seconds?: string
  size?: string
  prompt?: string
  createdAt?: string
  model?: string
  videoJobId?: string
}

type RunMetadata = {
  prompt?: string
  usedReference?: boolean
  videos?: VideoMetadataEntry[]
}

type LatestAssetsResponse = {
  runId: string
  images: AssetDescriptor[]
  video: AssetDescriptor | null
  progress?: Record<string, unknown> | null
  metadata?: RunMetadata | null
}

async function collectFiles(basePath: string, extensions: Set<string>) {
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true })
    const assets: AssetDescriptor[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!extensions.has(ext)) continue
      const fullPath = path.join(basePath, entry.name)
      const stats = await fs.stat(fullPath)
      assets.push({
        fileName: entry.name,
        url: buildPublicUrl(fullPath),
        relativePath: path.relative(getOutputsRoot(), fullPath),
        updatedAt: stats.mtime.toISOString(),
      })
    }
    return assets
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function buildPublicUrl(fullPath: string) {
  const root = getOutputsRoot()
  const relative = path.relative(root, fullPath)
  return `/outputs/${relative.replace(/\\/g, '/')}`
}

async function readProgress(basePath: string, relativePath?: string | null) {
  const candidates: string[] = []
  if (relativePath) {
    candidates.push(path.join(basePath, relativePath))
  }
  candidates.push(path.join(basePath, 'progress.json'))

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw err
    }
  }

  return null
}

async function loadRunAssets(runId: string, absolutePath: string): Promise<LatestAssetsResponse | null> {
  const imagesDir = path.join(absolutePath, 'images')
  const images = await collectFiles(imagesDir, IMAGE_EXTENSIONS)
  const fallbackImages =
    images.length > 0 ? images : await collectFiles(absolutePath, IMAGE_EXTENSIONS)

  const nestedVideoAssets = await collectVideoAssetsFromDirs(absolutePath)
  const flatVideoAssets = await collectFiles(absolutePath, VIDEO_EXTENSIONS)
  const combinedVideos =
    nestedVideoAssets.length > 0 ? nestedVideoAssets : flatVideoAssets
  const video = combinedVideos.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null

  const metadata = await readMetadata(absolutePath)
  const videoRelativeWithinRun = video ? getRunRelativePath(runId, video.relativePath) : null
  const metadataVideos = metadata?.videos ?? []
  const matchedMetadata =
    videoRelativeWithinRun && metadataVideos.length
      ? metadataVideos.find((entry) => entry.relativePath === videoRelativeWithinRun)
      : null

  let progressRelative: string | null = null
  if (matchedMetadata?.progressFile) {
    progressRelative = matchedMetadata.progressFile
  } else if (videoRelativeWithinRun) {
    progressRelative = inferProgressRelativePath(videoRelativeWithinRun)
  }
  if (!progressRelative) {
    progressRelative = await findLatestProgressRelativePath(absolutePath)
  }

  const progress = await readProgress(absolutePath, progressRelative)

  if (fallbackImages.length === 0 && !video && !progress) {
    return null
  }

  return {
    runId,
    images: fallbackImages,
    video,
    progress,
    metadata,
  }
}

const RESERVED_RUN_IDS = ['chosen', 'codex-uploads', 'codex-upload']

async function getChosenRun(): Promise<LatestAssetsResponse | null> {
  const outputsRoot = getOutputsRoot()
  const chosenPath = path.join(outputsRoot, 'chosen')
  try {
    const stats = await fs.stat(chosenPath)
    if (!stats.isDirectory()) return null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  return loadRunAssets('chosen', chosenPath)
}

async function collectVideoAssetsFromDirs(runPath: string) {
  const videosPath = path.join(runPath, 'videos')
  const assets: AssetDescriptor[] = []
  try {
    const entries = await fs.readdir(videosPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(videosPath, entry.name)
      const files = await fs.readdir(dirPath, { withFileTypes: true })
      for (const file of files) {
        if (!file.isFile()) continue
        const ext = path.extname(file.name).toLowerCase()
        if (!VIDEO_EXTENSIONS.has(ext)) continue
        const fullPath = path.join(dirPath, file.name)
        const stats = await fs.stat(fullPath)
        assets.push({
          fileName: file.name,
          url: buildPublicUrl(fullPath),
          relativePath: path.relative(getOutputsRoot(), fullPath).replace(/\\/g, '/'),
          updatedAt: stats.mtime.toISOString(),
        })
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
  return assets
}

function inferProgressRelativePath(videoRelativePath: string | null) {
  if (!videoRelativePath) return null
  const normalized = videoRelativePath.replace(/\\/g, '/')
  const baseName = path.posix.basename(normalized)
  const dirName = path.posix.dirname(normalized)
  const match = baseName.match(/^video-(.+)\.mp4$/)
  if (!match) return null
  return path.posix.join(dirName, `${SORA_PROGRESS_PREFIX}-${match[1]}.json`)
}

async function findLatestProgressRelativePath(runPath: string) {
  const videosPath = path.join(runPath, 'videos')
  const candidates: Array<{ relative: string; mtime: number }> = []
  try {
    const entries = await fs.readdir(videosPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(videosPath, entry.name)
      const files = await fs.readdir(dirPath, { withFileTypes: true })
      for (const file of files) {
        if (!file.isFile()) continue
        if (!file.name.startsWith(`${SORA_PROGRESS_PREFIX}-`) || path.extname(file.name).toLowerCase() !== '.json') continue
        const fullPath = path.join(dirPath, file.name)
        const stats = await fs.stat(fullPath)
        candidates.push({
          relative: path.relative(runPath, fullPath).replace(/\\/g, '/'),
          mtime: stats.mtimeMs,
        })
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }

  if (!candidates.length) {
    return null
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].relative
}

async function readMetadata(basePath: string) {
  const metadataPath = path.join(basePath, 'metadata.json')
  try {
    const raw = await fs.readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const videos = Array.isArray((parsed as { videos?: unknown }).videos)
      ? ((parsed as { videos?: VideoMetadataEntry[] }).videos ?? []).map((video) => ({
          ...video,
          relativePath: typeof video.relativePath === 'string' ? video.relativePath : undefined,
          progressFile: typeof video.progressFile === 'string' ? video.progressFile : undefined,
        }))
      : undefined
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      usedReference: Boolean((parsed as { usedReference?: unknown }).usedReference),
      videos,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

function getRunRelativePath(runId: string, outputsRelativePath: string) {
  const normalized = outputsRelativePath.replace(/\\/g, '/')
  const prefix = `${runId}/`
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length)
  }
  return normalized
}

function sortRunsByModified(runs: Awaited<ReturnType<typeof listRuns>>, exclude: string[]) {
  return Promise.all(
    runs
      .filter((run) => !exclude.includes(run.runId))
      .map(async (run) => {
        const stats = await fs.stat(run.absolutePath)
        return { ...run, mtimeMs: stats.mtimeMs }
      }),
  ).then((results) => results.sort((a, b) => b.mtimeMs - a.mtimeMs))
}

export async function GET() {
  try {
    const chosenAssets = await getChosenRun()
    if (chosenAssets) {
      logInfo('Returning chosen run assets', { runId: chosenAssets.runId })
      return json(chosenAssets)
    }

    const runs = await listRuns()
    const ordered = await sortRunsByModified(runs, RESERVED_RUN_IDS)

    for (const run of ordered) {
      const safeRunId = sanitizePathSegment(run.runId, run.runId)
      const assets = await loadRunAssets(safeRunId, resolveRunPath(run.runId))
      if (assets) {
        logInfo('Returning latest run assets', { runId: assets.runId })
        return json(assets)
      }
    }

    return error(404, 'No assets available')
  } catch (err) {
    logError('Failed to load latest assets', err)
    return error(500, 'Failed to load latest assets')
  }
}

export async function POST() {
  return methodNotAllowed(['GET'])
}
