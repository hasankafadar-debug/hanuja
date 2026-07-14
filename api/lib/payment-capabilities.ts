import { DomainError } from './errors'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

type PaymentEnvironment = Partial<
  Record<'CARD_PAYMENTS_ENABLED' | 'NODE_ENV', string | undefined>
>

export function isCardPaymentsEnabled(
  env: PaymentEnvironment = process.env,
): boolean {
  const configured = env.CARD_PAYMENTS_ENABLED?.trim().toLowerCase()
  if (configured) return TRUE_VALUES.has(configured)

  // Production fails closed until iyzico credentials are deliberately enabled.
  return env.NODE_ENV !== 'production'
}

export function assertPaymentMethodEnabled(
  paymentMethod: 'card' | 'eft',
  env: PaymentEnvironment = process.env,
): void {
  if (paymentMethod === 'card' && !isCardPaymentsEnabled(env)) {
    throw new DomainError(
      'Kartla ödeme geçici olarak kullanılamıyor. Lütfen Havale / EFT seçeneğini kullanın.',
      'CARD_PAYMENTS_DISABLED',
      503,
    )
  }
}
