import { auth, authHandler } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { revokeTrustedDevices } from '@hanuja/api/lib/auth-security'

const handlers = toNextJsHandler(authHandler)

async function handle(method: 'GET' | 'POST', request: Request) {
  const path = new URL(request.url).pathname
  const revokesTrust = method === 'POST' && [
    '/sign-out', '/change-password', '/two-factor/disable', '/revoke-sessions', '/revoke-other-sessions',
  ].some((suffix) => path.endsWith(suffix))
  const session = revokesTrust ? await auth.api.getSession({ headers: request.headers }) : null
  const response = await handlers[method](request)
  if (response.ok && session?.user) await revokeTrustedDevices(createPrismaForRoute(), session.user.id)
  return response
}

export async function GET(request: Request) { return handle('GET', request) }
export async function POST(request: Request) { return handle('POST', request) }
