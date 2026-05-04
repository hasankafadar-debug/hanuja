import { authHandler } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

const authRouteHandlers = toNextJsHandler(authHandler)

function logAuthRouteError(method: 'GET' | 'POST', request: Request, error: unknown) {
  const details = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : error

  console.error('[auth] Route handler failed', {
    method,
    url: request.url,
    details,
  })
}

async function handleAuthRequest(method: 'GET' | 'POST', request: Request) {
  try {
    return await authRouteHandlers[method](request)
  } catch (error) {
    logAuthRouteError(method, request, error)

    return Response.json(
      {
        code: 'AUTH_ROUTE_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? 'Auth istegi islenemedi. Sunucu loglarini ve veritabani baglantisini kontrol edin.'
            : 'Kimlik dogrulama istegi islenemedi.',
      },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  return handleAuthRequest('GET', request)
}

export async function POST(request: Request) {
  return handleAuthRequest('POST', request)
}
