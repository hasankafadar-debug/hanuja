/**
 * Server-side helper: resolves the authenticated seller from the current session.
 * Redirects to /giris if unauthenticated, /basvuru if seller profile not found.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function getSellerFromSession(options: { allowSuspended?: boolean } = {}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris')
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
  })

  if (!seller) {
    redirect('/basvuru')
  }

  if (seller.status === 'pending' || seller.status === 'rejected') {
    redirect('/basvuru')
  }

  if (seller.status === 'suspended' && !options.allowSuspended) {
    redirect('/siparisler?hesap=askida')
  }

  return { session, seller }
}
