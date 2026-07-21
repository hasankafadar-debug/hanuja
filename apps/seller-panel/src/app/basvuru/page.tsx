import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { resolveSellerApplicationState } from '@/lib/onboarding'
import OnboardingPage from '../onboarding/page'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default async function BasvuruPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return <OnboardingPage />
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { status: true },
  })

  const applicationState = resolveSellerApplicationState(session.user.role, seller?.status)

  if (applicationState === 'pending') {
    redirect('/basvuru/belgeler')
  }

  if (applicationState === 'panel') {
    redirect('/dashboard')
  }

  if (applicationState === 'rejected') {
    return (
      <ApplicationStatus
        title="Başvurunuz onaylanmadı"
        description="Mağaza başvurunuz değerlendirme sonucunda onaylanmadı. Ayrıntılı bilgi için Hanuja destek ekibiyle iletişime geçebilirsiniz."
      />
    )
  }

  if (applicationState === 'ineligible') {
    return (
      <ApplicationStatus
        title="Bu hesapla başvuru yapılamıyor"
        description="Mağaza başvurusu yalnızca doğrulanmış müşteri hesaplarıyla başlatılabilir. Başka bir müşteri hesabıyla giriş yapın."
      />
    )
  }

  return <OnboardingPage />
}

function ApplicationStatus({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-neutral-900">Hanuja Satıcı Başvurusu</p>
        <h1 className="mb-3 text-2xl font-semibold text-neutral-900">{title}</h1>
        <p className="text-sm leading-6 text-neutral-600">{description}</p>
        <a
          href="/giris?callbackUrl=/basvuru"
          className="mt-6 inline-flex rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
        >
          Başka hesapla giriş yap
        </a>
      </div>
    </main>
  )
}
