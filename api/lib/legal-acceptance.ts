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
