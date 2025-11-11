import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { NextRequest } from 'next/server'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import { logError } from '@/lib/server/logger'

export const runtime = 'nodejs'

const WORKSPACE_ROOT = process.cwd()
const CODEX_UPLOAD_ROOT = path.join(WORKSPACE_ROOT, 'public', 'codex-run')

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return error(400, 'Image file is required.')
    }
    if (file.size === 0) {
      return error(400, 'Image file is empty.')
    }

    const bucket = createUploadBucket()
    const targetDir = path.join(CODEX_UPLOAD_ROOT, bucket)
    await fs.mkdir(targetDir, { recursive: true })

    const safeName = sanitizeFilename(file.name)
    const targetPath = path.join(targetDir, safeName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(targetPath, buffer)

    const relativePath = path.relative(WORKSPACE_ROOT, targetPath)
    return json({
      ok: true,
      file: {
        name: safeName,
        path: relativePath,
        size: file.size,
      },
    })
  } catch (err) {
    logError('Failed to upload Codex image', err)
    return error(500, 'Failed to upload image')
  }
}

export function GET() {
  return methodNotAllowed(['POST'])
}

function sanitizeFilename(name: string) {
  const base = path.basename(name || 'image')
  const normalised = base.replace(/\s+/g, '-')
  const safe = normalised.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  return safe.length > 0 ? safe : `image-${Date.now()}`
}

function createUploadBucket() {
  return randomUUID().split('-')[0]
}
