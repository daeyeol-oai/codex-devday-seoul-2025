import { promises as fs } from 'fs'
import { NextRequest } from 'next/server'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import { resolveWorkspacePath } from '@/lib/server/fs-apply'
import { createSnapshot, getSnapshotSummary } from '@/lib/server/git'
import { logError, logInfo } from '@/lib/server/logger'

export const runtime = 'nodejs'

type ThemePayload = {
  primary: string
  accent: string
}

const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function validateTheme(payload: unknown): ThemePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Theme payload must be an object')
  }

  const { primary, accent } = payload as ThemePayload
  if (typeof primary !== 'string' || !COLOR_REGEX.test(primary)) {
    throw new Error('primary must be a valid hex color (e.g., #2563eb)')
  }
  if (typeof accent !== 'string' || !COLOR_REGEX.test(accent)) {
    throw new Error('accent must be a valid hex color (e.g., #38bdf8)')
  }

  return { primary, accent }
}

function updateToken(source: string, token: string, value: string) {
  const pattern = new RegExp(`(${token}\\s*:\\s*)([^;]+)(;)`)
  if (!pattern.test(source)) {
    throw new Error(`Token ${token} not found in theme file`)
  }
  return source.replace(pattern, `$1${value}$3`)
}

export async function POST(request: NextRequest) {
  try {
    const payload = validateTheme(await request.json())
    const themePath = resolveWorkspacePath('styles', 'theme.css')

    const content = await fs.readFile(themePath, 'utf8')
    let nextContent = updateToken(content, '--accent-primary', payload.primary)
    nextContent = updateToken(nextContent, '--accent-secondary', payload.accent)

    if (content === nextContent) {
      const summary = await getSnapshotSummary()
      logInfo('Theme update skipped (no changes)', { colors: payload })
      return json({ ok: true, theme: payload, snapshotCreated: false, hasSnapshots: summary.hasSnapshots })
    }

    await fs.writeFile(themePath, nextContent)

    const snapshot = await createSnapshot('theme-update')
    const summary = await getSnapshotSummary()

    logInfo('Theme updated', { snapshotCreated: Boolean(snapshot), colors: payload })

    return json({ ok: true, theme: payload, snapshotCreated: Boolean(snapshot), hasSnapshots: summary.hasSnapshots })
  } catch (err) {
    logError('Failed to update theme', err)
    return error(400, err instanceof Error ? err.message : 'Failed to update theme', { ok: false })
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
