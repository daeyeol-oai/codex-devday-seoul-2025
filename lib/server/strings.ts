export function sanitizeFileName(rawName: string, fallback = 'file') {
  const normalized = rawName.trim().toLowerCase()
  const safe = normalized.replace(/[^a-z0-9.\-_]/g, '-')
  const collapsed = safe.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return collapsed.length > 0 ? collapsed : fallback
}
