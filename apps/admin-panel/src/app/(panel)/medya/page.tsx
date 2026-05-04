import type { Metadata } from 'next'
import { getAdminSession } from '@/lib/admin-session'
import { MediaLibraryClient } from './_components/media-library-client'

export const metadata: Metadata = { title: 'Medya Kütüphanesi' }

export const dynamic = 'force-dynamic'

export default async function MediaLibraryPage() {
  await getAdminSession()

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl font-semibold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          Medya Kütüphanesi
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Slider, promo ve blog için merkezi medya yönetimi
        </p>
      </div>

      <MediaLibraryClient />
    </div>
  )
}
