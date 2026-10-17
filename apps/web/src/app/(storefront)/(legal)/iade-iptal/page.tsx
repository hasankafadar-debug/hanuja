import { JsonLd, buildOrganizationStructuredData, absoluteUrl } from '@hanuja/seo'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import type { Metadata } from 'next'
import { customerLegalHtml } from '@hanuja/api/lib/customer-legal-content'
import LegalDocumentHtml from '@/components/legal-document-html'

export const metadata: Metadata = {
  title: 'Hanuja İptal, Cayma ve İade Koşulları',
  robots: { index: true, follow: true },
}

export default function LegalPage() {
  return (
    <>
      <JsonLd
        data={buildOrganizationStructuredData({
          legalName: PLATFORM_LEGAL_INFO.companyLegalName,
          email: PLATFORM_LEGAL_INFO.supportEmail,
          merchantReturnLink: absoluteUrl('/iade-iptal'),
        })}
      />
      <LegalDocumentHtml html={customerLegalHtml('07')} />
    </>
  )
}
