import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import prisma from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'

export async function getActiveSellerIdOrThrow() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller || seller.status !== 'active') {
    throw new ForbiddenError('Aktif satici hesabi gerekli')
  }

  return seller.id
}
