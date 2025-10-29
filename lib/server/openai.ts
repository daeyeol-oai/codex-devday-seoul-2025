'use server'

import OpenAI from 'openai'
import { getEnv } from './env'

let client: OpenAI | null = null

export function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: getEnv('OPENAI_API_KEY'),
    })
  }
  return client
}

export function ensureOpenAIConfigured() {
  return getOpenAIClient()
}
