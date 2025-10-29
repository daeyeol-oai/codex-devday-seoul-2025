'use server'

import { Codex } from '@openai/codex-sdk'

import { getEnv } from './env'

let client: Codex | null = null

export function getCodexClient() {
  if (!client) {
    client = new Codex({
      apiKey: getEnv('OPENAI_API_KEY'),
    })
  }
  return client
}
