import { CheckoutPageClient } from './client-page'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'

// Kart ödemesi bayrağı istek anında okunur; build'e gömülmez.
export const dynamic = 'force-dynamic'

const CALLBACK_ERROR_CODES = new Set(['reddedildi', 'sure', 'dogrulama', 'sistem'])

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ siparis?: string | string[]; hata?: string | string[] }>
}) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const cardPaymentsEnabled = isCardPaymentsEnabled()
  const params = await searchParams
  const retryOrderId = typeof params.siparis === 'string' ? params.siparis : null
  const errorCode =
    typeof params.hata === 'string' && CALLBACK_ERROR_CODES.has(params.hata) ? params.hata : null

  return (
    <CheckoutPageClient
      cardPaymentsEnabled={cardPaymentsEnabled}
      turnstileSiteKey={turnstileSiteKey}
      retryOrderId={retryOrderId}
      callbackErrorCode={errorCode}
    />
  )
}
