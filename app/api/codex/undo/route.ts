import { NextRequest } from 'next/server'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import { applyLatestSnapshot } from '@/lib/server/git'
import { logError, logInfo } from '@/lib/server/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    await request.json().catch(() => ({}))
    const result = await applyLatestSnapshot()
    if (!result.applied) {
      return json({ restored: false, reason: result.reason ?? 'No snapshot to restore' }, { status: 409 })
    }
    logInfo('Applied latest Codex snapshot', {})
    return json({ restored: true })
  } catch (err) {
    logError('Failed to apply snapshot undo', err)
    return error(500, err instanceof Error ? err.message : 'Failed to apply snapshot')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
