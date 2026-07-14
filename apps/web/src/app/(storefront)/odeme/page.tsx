import { CheckoutPageClient } from './client-page'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'

export default function CheckoutPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const cardPaymentsEnabled = isCardPaymentsEnabled()

  return (
    <CheckoutPageClient
      cardPaymentsEnabled={cardPaymentsEnabled}
      turnstileSiteKey={turnstileSiteKey}
    />
  )
}
