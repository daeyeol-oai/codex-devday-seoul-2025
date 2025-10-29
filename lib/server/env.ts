'use server'

export type RequiredEnvVar = 'OPENAI_API_KEY'

export function getEnv(name: RequiredEnvVar) {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

export function isEnvConfigured(name: RequiredEnvVar) {
  const value = process.env[name]
  return Boolean(value && value.trim().length > 0)
}
