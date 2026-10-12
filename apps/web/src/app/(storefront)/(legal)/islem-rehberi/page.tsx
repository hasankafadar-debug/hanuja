import type { Metadata } from 'next'
import { customerLegalHtml } from '@hanuja/api/lib/customer-legal-content'
import LegalDocumentHtml from '@/components/legal-document-html'

export const metadata: Metadata = { title: "Hanuja İşlem Rehberi", robots: { index: true, follow: true } }

export default function LegalPage() {
  return <LegalDocumentHtml html={customerLegalHtml('08')} />
}
