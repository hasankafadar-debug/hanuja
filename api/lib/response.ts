import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { DomainError } from './errors'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

export function created<T>(data: T) {
  return ok(data, 201)
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json(
      {
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.statusCode },
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, code: 'VALIDATION_ERROR', errors: error.flatten() },
      { status: 422 },
    )
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: string }).code === 'P2021' || (error as { code?: string }).code === 'P2022')
  ) {
    return NextResponse.json(
      {
        success: false,
        code: 'SCHEMA_OUT_OF_SYNC',
        message:
          'Veritabanı şeması uygulama ile uyumlu görünmüyor. Lütfen migration durumunu kontrol edip `pnpm db:migrate:deploy` çalıştırın.',
      },
      { status: 503 },
    )
  }

  // Don't leak internals in production
  console.error('[API Error]', error)
  return NextResponse.json(
    { success: false, code: 'INTERNAL_ERROR', message: 'Sunucu hatası' },
    { status: 500 },
  )
}
