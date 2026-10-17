import type { PrismaClient } from '@prisma/client'

export interface LegalAcceptanceEvidence {
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
  sessionId: string | null
}

interface HeaderLikeRequest {
  headers: {
    get(name: string): string | null
  }
}

export function extractClientIp(req: HeaderLikeRequest) {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || null
  return req.headers.get('x-real-ip')
}

/**
 * Ödeme sağlayıcısına (iyzico fraud puanlaması) gönderilecek istemci IP'si.
 * X-Forwarded-For'un ilk değeri istemci tarafından yazılabilir; Coolify/Traefik'in koyduğu
 * X-Real-Ip, yoksa proxy'nin eklediği en sağdaki X-Forwarded-For değeri kullanılır.
 */
export function extractTrustedClientIp(req: HeaderLikeRequest): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (!forwardedFor) return null
  const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean)
  return hops[hops.length - 1] ?? null
}

export async function buildLegalAcceptanceEvidence(params: {
  prisma: PrismaClient
  req: HeaderLikeRequest
  userId: string
}): Promise<LegalAcceptanceEvidence> {
  const activeSession = await params.prisma.session.findFirst({
    where: {
      userId: params.userId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  return {
    acceptedAt: new Date(),
    ipAddress: extractClientIp(params.req),
    userAgent: params.req.headers.get('user-agent'),
    sessionId: activeSession?.id ?? null,
  }
}
