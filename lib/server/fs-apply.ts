import path from 'path'

const WORKSPACE_ROOT = process.cwd()
const ALLOWED_ROOTS = [
  path.join(WORKSPACE_ROOT, 'app'),
  path.join(WORKSPACE_ROOT, 'styles'),
  path.join(WORKSPACE_ROOT, 'public', 'outputs'),
]

export function isPathAllowed(targetPath: string) {
  const resolved = path.resolve(targetPath)
  return ALLOWED_ROOTS.some((root) => {
    const normalizedRoot = path.resolve(root)
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`)
  })
}

export function assertPathAllowed(targetPath: string) {
  if (!isPathAllowed(targetPath)) {
    throw new Error(`Path ${targetPath} is outside the allowed write roots`)
  }
}

export function resolveWorkspacePath(...segments: string[]) {
  const resolved = path.join(WORKSPACE_ROOT, ...segments)
  assertPathAllowed(resolved)
  return resolved
}
