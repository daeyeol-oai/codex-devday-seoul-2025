'use server'

import path from 'path'
import { promises as fs } from 'fs'

const OUTPUTS_ROOT = path.join(process.cwd(), 'public', 'outputs')

export type RunSummary = {
  runId: string
  absolutePath: string
}

export function getOutputsRoot() {
  return OUTPUTS_ROOT
}

export function createRunId(prefix = 'run') {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

export function sanitizePathSegment(raw: string, fallback: string) {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-_]/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

function assertWithinRoot(targetPath: string, root: string) {
  const relative = path.relative(root, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path ${targetPath} is outside of permitted root ${root}`)
  }
}

export async function ensureOutputsRoot() {
  await fs.mkdir(OUTPUTS_ROOT, { recursive: true })
}

export function resolveRunPath(runId: string, ...segments: string[]) {
  const safeRunId = sanitizePathSegment(runId, 'unknown-run')
  const fullPath = path.join(OUTPUTS_ROOT, safeRunId, ...segments)
  assertWithinRoot(fullPath, OUTPUTS_ROOT)
  return fullPath
}

export async function ensureRunDirectory(runId: string) {
  const runDir = resolveRunPath(runId)
  await fs.mkdir(runDir, { recursive: true })
  return runDir
}

export async function writeFileInRun(
  runId: string,
  relativePath: string,
  data: Buffer | string,
) {
  const targetPath = resolveRunPath(runId, relativePath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const buffer = typeof data === 'string' ? Buffer.from(data) : data
  await fs.writeFile(targetPath, buffer)
  return targetPath
}

export async function listRuns(): Promise<RunSummary[]> {
  await ensureOutputsRoot()
  const entries = await fs.readdir(OUTPUTS_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      runId: entry.name,
      absolutePath: path.join(OUTPUTS_ROOT, entry.name),
    }))
}
