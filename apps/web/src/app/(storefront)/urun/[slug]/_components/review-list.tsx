import { maskCustomerName } from '@hanuja/security'
import { ReviewStars } from './review-stars'

interface Review {
  id: string
  rating: number
  title: string | null
  body: string
  createdAt: Date | string
  customer: { name: string | null }
}

interface Props {
  reviews: Review[]
  total: number
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function ReviewList({ reviews, total }: Props) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Henüz değerlendirme yok. İlk değerlendirmeyi sen yap!
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Toplam {total} değerlendirme
      </p>
      <ul className="space-y-6">
        {reviews.map((r) => (
          <li
            key={r.id}
            className="border-b pb-5"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center gap-3">
              <ReviewStars value={r.rating} size={14} />
              <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                {maskCustomerName(r.customer.name)}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {formatDate(r.createdAt)}
              </span>
            </div>
            {r.title && (
              <h4 className="mt-2 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                {r.title}
              </h4>
            )}
            <p
              className="mt-2 text-sm leading-relaxed whitespace-pre-line"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              {r.body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
