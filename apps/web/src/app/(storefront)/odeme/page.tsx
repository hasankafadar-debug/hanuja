import { CheckoutPageClient } from './client-page'

export default function CheckoutPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return <CheckoutPageClient turnstileSiteKey={turnstileSiteKey} />
}
