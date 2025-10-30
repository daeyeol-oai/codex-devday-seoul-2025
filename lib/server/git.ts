import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { execFile as execFileCb } from 'child_process'
import { promises as fs } from 'fs'

const execFile = promisify(execFileCb)

const WORKSPACE_ROOT = process.cwd()
const SNAPSHOT_TRACK_FILE = path.join(WORKSPACE_ROOT, '.codex-snapshots.json')
const SNAPSHOT_PREFIX = 'codex-snapshot'

async function ensureGitRepo() {
  try {
    await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: WORKSPACE_ROOT })
    return true
  } catch {
    return false
  }
}

async function readSnapshotStack(): Promise<string[]> {
  try {
    const raw = await fs.readFile(SNAPSHOT_TRACK_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as string[]
    }
    return []
  } catch {
    return []
  }
}

async function writeSnapshotStack(entries: string[]) {
  await fs.writeFile(SNAPSHOT_TRACK_FILE, JSON.stringify(entries, null, 2))
}

async function workspaceHasChanges() {
  const { stdout } = await execFile('git', ['status', '--porcelain'], { cwd: WORKSPACE_ROOT })
  return stdout.trim().length > 0
}

async function listStashEntries() {
  const { stdout } = await execFile('git', ['stash', 'list', '--format=%gd::%gs'], {
    cwd: WORKSPACE_ROOT,
  })

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => {
      const [ref, label] = entry.split('::')
      return { ref, label }
    })
}

async function getPatchForRef(ref: string) {
  const { stdout } = await execFile('git', ['stash', 'show', '--patch', ref], { cwd: WORKSPACE_ROOT })
  return stdout
}

function extractPathsFromPatch(patch: string) {
  const paths = new Set<string>()
  const lines = patch.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const target = line.slice('+++ b/'.length).trim()
      if (target && target !== '/dev/null') {
        paths.add(target)
      }
    }
    if (line.startsWith('--- a/')) {
      const target = line.slice('--- a/'.length).trim()
      if (target && target !== '/dev/null') {
        paths.add(target)
      }
    }
  }
  return Array.from(paths)
}

export async function createSnapshot(label: string) {
  if (!(await ensureGitRepo())) {
    return null
  }

  if (!(await workspaceHasChanges())) {
    return null
  }

  const snapshotLabel = `${SNAPSHOT_PREFIX}:${Date.now()}:${label}`
  await execFile('git', ['stash', 'push', '--include-untracked', '--message', snapshotLabel], {
    cwd: WORKSPACE_ROOT,
  })

  try {
    await execFile('git', ['stash', 'apply', 'stash@{0}'], { cwd: WORKSPACE_ROOT })
  } catch (err) {
    console.warn('[codex] Failed to reapply snapshot to working tree', err)
  }

  const stack = await readSnapshotStack()
  stack.push(snapshotLabel)
  await writeSnapshotStack(stack)
  return snapshotLabel
}

export async function applyLatestSnapshot() {
  if (!(await ensureGitRepo())) {
    return { applied: false, reason: 'Repository not initialised' }
  }

  const stack = await readSnapshotStack()
  const snapshotLabel = stack.pop()
  if (!snapshotLabel) {
    return { applied: false, reason: 'No snapshots available' }
  }

  const entries = await listStashEntries()
  const target = entries.find((entry) => entry.label === snapshotLabel)
  if (!target) {
    await writeSnapshotStack(stack)
    return { applied: false, reason: 'Snapshot expired or already applied' }
  }

  const targetPatch = await getPatchForRef(target.ref)
  const targetPaths = extractPathsFromPatch(targetPatch)
  try {
    await execFile('git', ['stash', 'drop', target.ref], { cwd: WORKSPACE_ROOT })
  } catch (err) {
    await writeSnapshotStack(stack)
    throw err
  }

  await writeSnapshotStack(stack)

  if (stack.length === 0) {
    if (targetPaths.length > 0) {
      await execFile('git', ['checkout', '--', ...targetPaths], { cwd: WORKSPACE_ROOT })
    }
    return { applied: true, remaining: 0 }
  }

  const remainingEntries = await listStashEntries()
  const latestLabel = stack[stack.length - 1]
  const latest = remainingEntries.find((entry) => entry.label === latestLabel)
  if (!latest) {
    return { applied: true, remaining: stack.length }
  }

  const latestPatch = await getPatchForRef(latest.ref)
  const latestPaths = extractPathsFromPatch(latestPatch)
  if (latestPaths.length > 0) {
    await execFile('git', ['checkout', '--', ...latestPaths], { cwd: WORKSPACE_ROOT })
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-patch-'))
  const patchPath = path.join(tmpDir, 'snapshot.patch')
  try {
    await fs.writeFile(patchPath, latestPatch, 'utf8')
    await execFile('git', ['apply', '--whitespace=nowarn', patchPath], { cwd: WORKSPACE_ROOT })
  } catch (err) {
    throw err
  } finally {
    await fs.rm(patchPath, { force: true }).catch(() => {})
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  return { applied: true, remaining: stack.length }
}

export async function getSnapshotSummary() {
  const stack = await readSnapshotStack()
  return {
    hasSnapshots: stack.length > 0,
    snapshots: stack,
  }
}
