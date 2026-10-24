// Public GA4 stream identifier, not a credential. Hanuja Web (property 560604998).
export const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-79EPBQSRW2'
export const GOOGLE_ANALYTICS_COOKIE_NAMES = ['_ga', '_ga_79EPBQSRW2'] as const

/** Do not send account/order identifiers, reset tokens, search terms or URL fragments. */
export function analyticsPagePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  const privateArea = /^\/(hesabim|siparis|faturalarim|odeme|sifre-sifirla|sifre-yenile|sifre-unuttum)(?:\/|$)/.exec(path)
  return privateArea ? `/${privateArea[1]}` : path
}
