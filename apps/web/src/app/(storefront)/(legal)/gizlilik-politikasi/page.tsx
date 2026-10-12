import type { Metadata } from 'next'
import { customerLegalHtml } from '@hanuja/api/lib/customer-legal-content'
import LegalDocumentHtml from '@/components/legal-document-html'

export const metadata: Metadata = { title: "Hanuja Gizlilik Politikası", robots: { index: true, follow: true } }

export default function LegalPage() {
  return <LegalDocumentHtml html={customerLegalHtml('01')} />
}
