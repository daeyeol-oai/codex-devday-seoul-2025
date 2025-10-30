import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { error, json, methodNotAllowed } from '@/lib/server/http'
import { createRunId, ensureRunDirectory, writeFileInRun } from '@/lib/server/storage'
import { sanitizeFileName } from '@/lib/server/strings'
import { logError, logInfo } from '@/lib/server/logger'
import { getOpenAIClient } from '@/lib/server/openai'
import { toFile } from 'openai'

export const runtime = 'nodejs'

const IMAGE_COUNT = 5
const IMAGE_SIZE = '1536x1024'
const IMAGE_MODEL = 'gpt-image-1-mini'

type GeneratedImagePayload = {
  id: string
  fileName: string
  url: string
  width?: number
  height?: number
  createdAt: string
  model: string
  size: string
}

type ImageResponse = {
  runId: string
  createdAt: string
  prompt: string
  sketch?: {
    fileName: string
    url: string | null
  } | null
  images: GeneratedImagePayload[]
  model: string
  usedReference: boolean
}

function ensureFileName(baseName: string) {
  const sanitized = sanitizeFileName(baseName, 'image').replace(/\.[^.]+$/, '')
  return sanitized.length > 0 ? sanitized : 'image'
}

async function normaliseSketch(sketch: File) {
  const sketchBuffer = Buffer.from(await sketch.arrayBuffer())
  return sharp(sketchBuffer).png().toBuffer()
}

async function writeMetadata(runId: string, payload: ImageResponse) {
  await writeFileInRun(runId, 'metadata.json', JSON.stringify(payload, null, 2))
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const prompt = formData.get('prompt')
    const sketch = formData.get('sketch')

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      return error(400, 'Prompt is required')
    }
    const hasSketch = sketch instanceof File && sketch.size > 0

    const promptValue = prompt.trim()
    const runId = createRunId('images')
    await ensureRunDirectory(runId)

    let normalizedSketch: Buffer | null = null
    let sketchFileName: string | null = null
    let sketchRelativePath: string | null = null

    if (hasSketch) {
      try {
        normalizedSketch = await normaliseSketch(sketch as File)
        sketchFileName = `${ensureFileName((sketch as File).name || 'sketch.png')}.png`
        sketchRelativePath = `input/${sketchFileName}`
        await writeFileInRun(runId, sketchRelativePath, normalizedSketch)
      } catch (conversionError) {
        logError('Sketch normalization failed', conversionError)
        return error(400, 'Uploaded sketch must be a supported image format')
      }
    }

    const createdAt = new Date().toISOString()

    let imagesResponse
    const client = getOpenAIClient()
    try {
      if (hasSketch && normalizedSketch) {
        const referenceFile = await toFile(normalizedSketch, sketchFileName ?? 'sketch.png', {
          type: 'image/png',
        })
        imagesResponse = await client.images.edit({
          model: IMAGE_MODEL,
          image: referenceFile,
          prompt: promptValue,
          n: IMAGE_COUNT,
          size: IMAGE_SIZE,
          output_format: 'png',
        })
      } else {
        imagesResponse = await client.images.generate({
          model: IMAGE_MODEL,
          prompt: promptValue,
          n: IMAGE_COUNT,
          size: IMAGE_SIZE,
          output_format: 'png',
        })
      }
    } catch (apiError) {
      logError('OpenAI image generation failed', apiError, { runId, usedReference: hasSketch })
      return error(502, 'Image generation request failed')
    }

    const items = imagesResponse.data ?? []
    if (items.length === 0) {
      logError('OpenAI response contained no images', new Error('empty result'), { runId })
      return error(502, 'No images returned from model')
    }

    const images: GeneratedImagePayload[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const base64 = item.b64_json
      if (!base64) {
        logError('Missing b64_json payload for generated image', new Error('missing b64_json'), {
          runId,
          index,
        })
        continue
      }

      const buffer = Buffer.from(base64, 'base64')
      const fileName = `image-${index + 1}.png`
      const relativePath = `images/${fileName}`
      await writeFileInRun(runId, relativePath, buffer)

      const metadata = await sharp(buffer).metadata().catch(() => null)

      images.push({
        id: `${runId}-img-${index + 1}`,
        fileName,
        url: `/outputs/${runId}/${relativePath}`,
        width: metadata?.width,
        height: metadata?.height,
        createdAt,
        model: IMAGE_MODEL,
        size: IMAGE_SIZE,
      })
    }

    if (images.length === 0) {
      return error(502, 'Image generation failed')
    }

    const response: ImageResponse = {
      runId,
      createdAt,
      prompt: promptValue,
      sketch: hasSketch
        ? {
            fileName: sketchFileName!,
            url: sketchRelativePath ? `/outputs/${runId}/${sketchRelativePath}` : null,
          }
        : null,
      images,
      model: IMAGE_MODEL,
      usedReference: hasSketch,
    }

    await writeMetadata(runId, response)

    logInfo('Generated images from OpenAI models', {
      runId,
      count: images.length,
      model: IMAGE_MODEL,
    })

    return json(response, {
      status: 201,
      headers: {
        'x-run-id': runId,
        'x-openai-model': IMAGE_MODEL,
      },
    })
  } catch (err) {
    logError('Failed to generate images', err)
    return error(500, 'Failed to generate images')
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
