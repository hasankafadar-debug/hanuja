import Link from 'next/link'

/**
 * Shown alongside every seller category picker (single add/edit, bulk upload,
 * URL import). Sellers cannot create categories themselves; a missing leaf
 * category is requested through the support ticket system at /destek.
 */
export function CategorySupportHint({ className }: { className?: string }) {
  return (
    <p className={className} style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>
      Aradığınız Alt kategoriniz yoksa{' '}
      <Link
        href="/destek"
        style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
      >
        Admin Destek
      </Link>{' '}
      bölümünden istediğiniz kategoriyi yazarak talep edebilirsiniz.
    </p>
  )
}
