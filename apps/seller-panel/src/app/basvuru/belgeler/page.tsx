import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PrismaClient, type SellerDocumentType } from '@prisma/client'
import { maskIban } from '@hanuja/security'
import { auth } from '@/lib/auth'
import DocumentsForm from '@/app/(panel)/ayarlar/_components/documents-form'
import StoreProfileForm from '@/app/(panel)/ayarlar/_components/store-profile-form'

export const dynamic = 'force-dynamic'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const DOCUMENT_TYPES = [
  'identity',
  'tax_certificate',
  'trade_registry',
  'signature_circular',
  'bank_statement',
  'contract',
  'other',
] as const satisfies readonly SellerDocumentType[]

type PageProps = {
  searchParams: Promise<{ token?: string | string[] }>
}

/**
 * The single authenticated workspace for applicants whose seller account is
 * pending. Old email links can still land here, but their legacy token is
 * deliberately ignored and removed from the address bar.
 */
export default async function BasvuruBelgelerPage({ searchParams }: PageProps) {
  const { token } = await searchParams
  if (token) redirect('/basvuru/belgeler')

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/giris?callbackUrl=/basvuru/belgeler')

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    include: {
      profile: true,
      documents: { orderBy: { createdAt: 'desc' } },
      bankDetails: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  if (!seller) redirect('/basvuru')
  if (seller.status === 'active' || seller.status === 'suspended') redirect('/dashboard')
  if (seller.status === 'rejected') redirect('/basvuru')

  const requestedTypes = Array.isArray(seller.requiredDocumentTypes)
    ? seller.requiredDocumentTypes.filter((type): type is SellerDocumentType =>
        DOCUMENT_TYPES.includes(String(type) as SellerDocumentType),
      )
    : []
  const legalFieldsLocked = seller.documents.length > 0
  const bank = seller.bankDetails[0] ?? null

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <section className="border-b border-neutral-200 pb-6">
          <p className="text-sm font-semibold text-neutral-900">Hanuja Satıcı Başvurusu</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
                Başvurunuz inceleniyor
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
                İstenen belgeleri yükleyin. Tüm kontroller tamamlandığında mağazanız satışa
                açılacaktır.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              İnceleme bekliyor
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
          <DocumentsForm
            requestedTypes={requestedTypes}
            initialDocuments={seller.documents.map((document) => ({
              id: document.id,
              type: document.type,
              status: document.status,
              identityPart: document.identityPart,
              uploadGroupId: document.uploadGroupId,
              uploadOrder: document.uploadOrder,
              uploadGroupSize: document.uploadGroupSize,
              fileName: document.fileName,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes,
              fileUrl: document.fileUrl,
              adminNote: document.adminNote ?? null,
              createdAt: document.createdAt.toISOString(),
            }))}
          />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-neutral-900">
              Mağaza ve işletme bilgileri
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Mağaza adı, açıklama ve telefon bilginizi inceleme sırasında güncelleyebilirsiniz.
            </p>
          </div>
          <StoreProfileForm
            storeName={seller.displayName}
            bio={seller.profile?.bio ?? ''}
            phone={seller.profile?.phone ?? ''}
            companyName={seller.profile?.companyName ?? ''}
            legalAddress={seller.profile?.legalAddress ?? ''}
            district={seller.profile?.district ?? ''}
            city={seller.profile?.city ?? ''}
            postalCode={seller.profile?.postalCode ?? ''}
            taxOffice={seller.profile?.taxOffice ?? ''}
            taxNumber={seller.profile?.taxNumber ?? ''}
            mersis={seller.profile?.mersis ?? ''}
            legalFieldsLocked={legalFieldsLocked}
          />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-semibold text-neutral-900">Banka bilgileri</h2>
          {bank ? (
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-neutral-500">Banka</dt>
                <dd className="mt-1 font-medium text-neutral-900">{bank.bankName}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Hesap sahibi</dt>
                <dd className="mt-1 font-medium text-neutral-900">{bank.accountHolder}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">IBAN</dt>
                <dd className="mt-1 font-medium text-neutral-900">{maskIban(bank.iban)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">Banka bilgisi bulunamadı.</p>
          )}
          <p className="mt-4 text-xs text-neutral-500">
            Banka bilgileriniz başvuru incelemesi tamamlanana kadar görüntülenebilir ancak
            değiştirilemez.
          </p>
        </section>
      </div>
    </main>
  )
}
