import { auth, authHandler } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { revokeTrustedDevices } from '@hanuja/api/lib/auth-security'

const authRouteHandlers = toNextJsHandler(authHandler)

function logAuthRouteError(method: 'GET' | 'POST', request: Request, error: unknown) {
  const details = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : error

  console.error('[admin-auth] Route handler failed', {
    method,
    url: request.url,
    details,
  })
}

async function handleAuthRequest(method: 'GET' | 'POST', request: Request) {
  try {
    const path = new URL(request.url).pathname
    const revokesTrust = method === 'POST' && [
      '/sign-out', '/change-password', '/two-factor/disable', '/revoke-sessions', '/revoke-other-sessions',
    ].some((suffix) => path.endsWith(suffix))
    const session = revokesTrust ? await auth.api.getSession({ headers: request.headers }) : null
    const response = await authRouteHandlers[method](request)
    if (response.ok && session?.user) await revokeTrustedDevices(createPrismaForRoute(), session.user.id)
    return response
  } catch (error) {
    logAuthRouteError(method, request, error)

    return Response.json(
      {
        code: 'AUTH_ROUTE_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? 'Admin auth istegi islenemedi. Sunucu loglarini ve DATABASE_URL ayarini kontrol edin.'
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
