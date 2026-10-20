import { NextResponse } from 'next/server'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'

/** Legacy card-data entry is permanently retired. Callbacks remain available. */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      code: isCardPaymentsEnabled() ? 'DIRECT_CARD_ENTRY_RETIRED' : 'CARD_PAYMENTS_DISABLED',
      message: 'Kartla ödeme için gömülü iyzico alanını kullanın.',
    },
    { status: isCardPaymentsEnabled() ? 410 : 503 },
  )
}
