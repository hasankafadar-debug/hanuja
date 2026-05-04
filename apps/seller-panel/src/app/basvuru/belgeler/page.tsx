import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const DOC_LABELS: Record<string, string> = {
  identity: 'Kimlik Belgesi',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Belgesi',
  other: 'Diğer',
}

export default async function BasvuruBelgelerPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris')
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    include: { documents: true },
  })

  if (!seller) {
    return (
      <div className="min-h-screen bg-neutral-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-neutral-900 mb-2">Belge alanı</h1>
          <p className="text-sm text-neutral-600">Aktif bir satıcı başvurusu bulunamadı.</p>
        </div>
      </div>
    )
  }

  const requested = Array.isArray(seller.requiredDocumentTypes)
    ? seller.requiredDocumentTypes.map((item) => String(item))
    : []

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Belge yükleme</h1>
        <p className="text-sm text-neutral-600">
          Başvuru durumunuz: <span className="font-medium text-neutral-900">{seller.status}</span>
        </p>

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Talep edilen belgeler</h2>
          {requested.length === 0 ? (
            <p className="text-sm text-neutral-500">Henüz bir belge talebi yok.</p>
          ) : (
            <ul className="grid gap-2">
              {requested.map((doc) => (
                <li key={doc} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700">
                  {DOC_LABELS[doc] ?? doc}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Yüklenen belgeler</h2>
          {seller.documents.length === 0 ? (
            <p className="text-sm text-neutral-500">Henüz belge yüklenmedi.</p>
          ) : (
            <div className="grid gap-2">
              {seller.documents.map((doc) => (
                <div key={doc.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700">
                  {DOC_LABELS[doc.type] ?? doc.type} - {doc.status}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-6 text-xs text-neutral-400">
          Belgeleriniz incelendikten sonra hesabınız aktif hale getirilir.
        </p>
      </div>
    </div>
  )
}
