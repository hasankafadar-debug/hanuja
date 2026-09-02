import { DomainError } from './errors'

type PaymentEnvironment = Partial<Record<'CARD_PAYMENTS_ENABLED' | 'NODE_ENV', string | undefined>>

export function isCardPaymentsEnabled(_env: PaymentEnvironment = process.env): boolean {
  // No provider-neutral charge adapter is wired yet. Card sales remain closed
  // in every environment until the new payment provider integration ships.
  return false
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
