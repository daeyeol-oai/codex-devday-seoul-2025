import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import { createRunId, ensureRunDirectory, writeFileInRun } from '@/lib/server/storage'
import { sanitizeFileName } from '@/lib/server/strings'
import { logError, logInfo } from '@/lib/server/logger'
import { ensureOpenAIConfigured } from '@/lib/server/openai'

export const runtime = 'nodejs'

const MOCK_COLORS = [
  { background: '#f2d6a0', accent: '#d68c45' },
  { background: '#f4dfbc', accent: '#e0a937' },
  { background: '#d8e8e8', accent: '#5ca8b5' },
  { background: '#f1e0c5', accent: '#4d9db8' },
  { background: '#f3ddbe', accent: '#e78b2f' },
]

type GeneratedImagePayload = {
  id: string
  fileName: string
  url: string
  backgroundColor: string
  accentColor: string
  description: string
  title: string
  createdAt: string
}

type ImageResponse = {
  runId: string
  createdAt: string
  prompt: string
  sketch: {
    fileName: string
    url: string
  }
  images: GeneratedImagePayload[]
}

const ROBOT_TITLES = [
  'Quiet companion',
  'Curious explorer',
  'Sketch helper',
  'Story sidekick',
  'Bright inventor',
]

function createSvgPlaceholder(accent: string, background: string, title: string) {
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
  <rect width="512" height="768" fill="${background}"/>
  <g transform="translate(0,0)">
    <rect x="128" y="200" width="256" height="256" rx="48" ry="48" fill="${accent}"/>
    <text x="256" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="160" fill="#ffffff">🤖</text>
  </g>
  <text x="256" y="560" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#2a2a2a">${safeTitle}</text>
</svg>`
}

export async function POST(request: NextRequest) {
  try {
    ensureOpenAIConfigured()
    const formData = await request.formData()
    const prompt = formData.get('prompt')
    const sketch = formData.get('sketch')

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      return error(400, 'Prompt is required')
    }

    if (!(sketch instanceof File)) {
      return error(400, 'Sketch file is required')
    }

    const promptValue = prompt.trim()
    const runId = createRunId('images')
    await ensureRunDirectory(runId)

    const originalBuffer = Buffer.from(await sketch.arrayBuffer())

    let normalizedSketch: Buffer
    try {
      normalizedSketch = await sharp(originalBuffer).png().toBuffer()
    } catch (conversionError) {
      logError('Sketch normalization failed', conversionError)
      return error(400, 'Uploaded sketch must be a supported image format')
    }

    const sanitizedBase = sanitizeFileName(sketch.name || 'sketch.png', 'sketch')
      .replace(/\.[^.]+$/, '')
    const sketchFileName = `${sanitizedBase || 'sketch'}.png`
    const sketchPath = `input/${sketchFileName}`

    await writeFileInRun(runId, sketchPath, normalizedSketch)

    const createdAt = new Date().toISOString()
    const images: GeneratedImagePayload[] = await Promise.all(
      MOCK_COLORS.map(async (palette, index) => {
        const title = ROBOT_TITLES[index % ROBOT_TITLES.length]
        const svgContent = createSvgPlaceholder(palette.accent, palette.background, title)
        const fileName = `image-${index + 1}.svg`
        const relativePath = `images/${fileName}`
        await writeFileInRun(runId, relativePath, svgContent)

        return {
          id: `${runId}-img-${index + 1}`,
          fileName,
          url: `/outputs/${runId}/images/${fileName}`,
          backgroundColor: palette.background,
          accentColor: palette.accent,
          title,
          description: `Mock illustration generated for prompt: ${promptValue}`,
          createdAt,
        }
      }),
    )

    logInfo('Generated mock image set', { runId, prompt: promptValue })

    const response: ImageResponse = {
      runId,
      createdAt,
      prompt: promptValue,
      sketch: {
        fileName: sketchFileName,
        url: `/outputs/${runId}/${sketchPath}`,
      },
      images,
    }

    return json(response, { status: 201, headers: { 'x-run-id': runId } })
  } catch (err) {
    logError('Failed to generate mock images', err)
    return error(500, 'Failed to generate images')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
