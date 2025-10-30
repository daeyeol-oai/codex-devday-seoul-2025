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

type AssetDescriptor = {
  fileName: string
  url: string
  relativePath: string
  updatedAt: string
}

type LatestAssetsResponse = {
  runId: string
  images: AssetDescriptor[]
  video: AssetDescriptor | null
  progress?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
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

async function readProgress(basePath: string) {
  const progressPath = path.join(basePath, 'progress.json')
  try {
    const raw = await fs.readFile(progressPath, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

async function loadRunAssets(runId: string, absolutePath: string): Promise<LatestAssetsResponse | null> {
  const imagesDir = path.join(absolutePath, 'images')
  const images = await collectFiles(imagesDir, IMAGE_EXTENSIONS)
  const fallbackImages =
    images.length > 0 ? images : await collectFiles(absolutePath, IMAGE_EXTENSIONS)

  const videoAssets = await collectFiles(absolutePath, VIDEO_EXTENSIONS)
  const video = videoAssets.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null

  const progress = await readProgress(absolutePath)
  const metadata = await readMetadata(absolutePath)

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

async function readMetadata(basePath: string) {
  const metadataPath = path.join(basePath, 'metadata.json')
  try {
    const raw = await fs.readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      usedReference: Boolean((parsed as { usedReference?: unknown }).usedReference),
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
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
    const ordered = await sortRunsByModified(runs, ['chosen'])

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
