export function logInfo(message: string, context?: Record<string, unknown>) {
  console.info(`[api] ${message}`, context ?? {})
}

export function logError(message: string, error: unknown, context?: Record<string, unknown>) {
  const payload = {
    ...(context ?? {}),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
  }
  console.error(`[api] ${message}`, payload)
}
