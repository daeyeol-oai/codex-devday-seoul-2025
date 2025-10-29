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

  const { stdout } = await execFile('git', ['stash', 'list', '--format=%gd::%gs'], {
    cwd: WORKSPACE_ROOT,
  })

  const entries = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const match = entries.find((line) => line.includes(snapshotLabel))
  if (!match) {
    await writeSnapshotStack(stack)
    return { applied: false, reason: 'Snapshot expired or already applied' }
  }

  const [ref] = match.split('::')
  try {
    await execFile('git', ['stash', 'pop', ref], { cwd: WORKSPACE_ROOT })
  } catch (err) {
    await writeSnapshotStack(stack)
    throw err
  }

  await writeSnapshotStack(stack)
  return { applied: true }
}
