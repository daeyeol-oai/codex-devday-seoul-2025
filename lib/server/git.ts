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

type StashEntry = {
  ref: string
  label: string
}

async function listStashEntries(): Promise<StashEntry[]> {
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

async function filterSnapshotStack(stack: string[]) {
  const entries = await listStashEntries()
  const filtered = stack.filter((label) => entries.some((entry) => entry.label.includes(label)))
  if (filtered.length !== stack.length) {
    await writeSnapshotStack(filtered)
  }
  return { filtered, entries }
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

  let stack = await readSnapshotStack()
  const initial = await filterSnapshotStack(stack)
  stack = initial.filtered
  let entries = initial.entries

  while (stack.length > 0) {
    const snapshotLabel = stack.pop()!
    const target = entries.find((entry) => entry.label.includes(snapshotLabel))
    if (!target) {
      continue
    }

    const targetPatch = await getPatchForRef(target.ref)
    const targetPaths = extractPathsFromPatch(targetPatch)
    try {
      await execFile('git', ['stash', 'drop', target.ref], { cwd: WORKSPACE_ROOT })
    } catch (err) {
      stack.push(snapshotLabel)
      await writeSnapshotStack(stack)
      throw err
    }

    await writeSnapshotStack(stack)

    if (targetPaths.length > 0) {
      await execFile('git', ['checkout', '--', ...targetPaths], { cwd: WORKSPACE_ROOT })
    }

    if (stack.length === 0) {
      return { applied: true, remaining: 0 }
    }

    const next = await filterSnapshotStack(stack)
    stack = next.filtered
    entries = next.entries

    const latestLabel = stack[stack.length - 1]
    const latest = entries.find((entry) => entry.label.includes(latestLabel))
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

  await writeSnapshotStack(stack)
  return { applied: false, reason: 'No snapshots available' }
}

export async function getSnapshotSummary() {
  const stack = await readSnapshotStack()
  const { filtered } = await filterSnapshotStack(stack)
  return {
    hasSnapshots: filtered.length > 0,
    snapshots: filtered,
  }
}

export async function dropSnapshot(snapshotLabel: string) {
  const stack = await readSnapshotStack()
  const index = stack.lastIndexOf(snapshotLabel)
  if (index === -1) {
    return { dropped: false, reason: 'not_found' as const }
  }

  stack.splice(index, 1)
  await writeSnapshotStack(stack)

  const entries = await listStashEntries()
  const target = entries.find((entry) => entry.label.includes(snapshotLabel))
  if (target) {
    try {
      await execFile('git', ['stash', 'drop', target.ref], { cwd: WORKSPACE_ROOT })
    } catch (err) {
      console.warn('[codex] Failed to drop stash entry', { label: snapshotLabel, error: err })
      return { dropped: false, reason: 'drop_failed' as const }
    }
  }

  return { dropped: true as const }
}
