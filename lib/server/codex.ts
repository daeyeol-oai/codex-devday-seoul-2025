import { Codex, type Thread, type ThreadOptions } from '@openai/codex-sdk'

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

export function startWorkspaceThread(options?: ThreadOptions): Thread {
  const baseOptions: ThreadOptions = {
    sandboxMode: 'workspace-write',
    workingDirectory: process.cwd(),
    ...options,
  }
  return getCodexClient().startThread(baseOptions)
}
