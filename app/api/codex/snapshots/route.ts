import { NextRequest } from 'next/server'

import { json, methodNotAllowed } from '@/lib/server/http'
import { getSnapshotSummary } from '@/lib/server/git'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const summary = await getSnapshotSummary()
    return json({ ok: true, hasSnapshots: summary.hasSnapshots, snapshots: summary.snapshots })
  } catch (err) {
    logError('Failed to read snapshot summary', err)
    return json({ ok: false, hasSnapshots: false, snapshots: [] }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  await request.json().catch(() => ({}))
  return methodNotAllowed(['GET'])
}
