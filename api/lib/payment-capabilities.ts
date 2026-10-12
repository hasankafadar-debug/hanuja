import { DomainError } from './errors'

type PaymentEnvironment = Partial<
  Record<'CARD_PAYMENTS_ENABLED' | 'IYZICO_CARD_PAYMENTS_ENABLED' | 'NODE_ENV', string | undefined>
>

/**
 * Card sales run on Hanuja's standard iyzico virtual POS (satıcı Hanuja modeli). They stay
 * closed until `IYZICO_CARD_PAYMENTS_ENABLED=true` is set, which happens only after iyzico's
 * approval and once the new sales contracts are live. The legacy `CARD_PAYMENTS_ENABLED`
 * flag may still be `true` in older environments and must never reopen card sales.
 */
export function isCardPaymentsEnabled(env: PaymentEnvironment = process.env): boolean {
  return env.IYZICO_CARD_PAYMENTS_ENABLED?.trim().toLowerCase() === 'true'
}

export function assertPaymentMethodEnabled(
  paymentMethod: 'card' | 'eft',
  env: PaymentEnvironment = process.env,
): void {
  if (paymentMethod === 'card' && !isCardPaymentsEnabled(env)) {
    throw new DomainError(
      'Kartla ödeme sunulmuyor. Lütfen Havale / EFT seçeneğini kullanın.',
      'CARD_PAYMENTS_DISABLED',
      503,
    )
  }
}
