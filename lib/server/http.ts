'use server'

import { NextResponse } from 'next/server'

export type ErrorPayload = {
  error: string
  details?: Record<string, unknown>
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function error(status: number, message: string, details?: Record<string, unknown>) {
  return NextResponse.json<ErrorPayload>(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    {
      status,
    },
  )
}

export function methodNotAllowed(allowed: string[]) {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      details: { allowed },
    },
    { status: 405, headers: { Allow: allowed.join(', ') } },
  )
}
