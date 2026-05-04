import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import OnboardingPage from '../onboarding/page'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default async function BasvuruPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    redirect('/giris?callbackUrl=/basvuru')
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { status: true },
  })

  if (seller?.status === 'pending') {
    redirect('/basvuru/tesekkur')
  }

  if (seller) {
    redirect('/dashboard')
  }

  return <OnboardingPage />
}
