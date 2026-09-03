/**
 * Domain error hierarchy.
 * All errors carry an HTTP statusCode and machine-readable code.
 * Use handleError() in api/lib/response.ts to map these to JSON responses.
 */

export class DomainError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    message: string,
    code: string,
    statusCode = 400,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} bulunamadı: ${id}` : `${resource} bulunamadı`,
      'NOT_FOUND',
      404,
    )
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Kimlik doğrulama gerekli') {
    super(message, 'UNAUTHORIZED', 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Bu işlem için yetkiniz yok') {
    super(message, 'FORBIDDEN', 403)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 422)
    this.name = 'ValidationError'
  }
}

export class PayoutBlockedError extends DomainError {
  constructor(reason: string) {
    super(`Ödeme bloke: ${reason}`, 'PAYOUT_BLOCKED', 409)
    this.name = 'PayoutBlockedError'
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `Geçersiz sipariş durum geçişi: ${from} → ${to}`,
      'INVALID_TRANSITION',
      409,
    )
    this.name = 'InvalidTransitionError'
  }
}

export class SellerNotActiveError extends DomainError {
  constructor() {
    super('Satıcı hesabı aktif değil', 'SELLER_NOT_ACTIVE', 403)
    this.name = 'SellerNotActiveError'
  }
}

export class SellerSuspendedError extends DomainError {
  constructor(productName?: string) {
    super(
      productName
        ? `"${productName}" satıcısı askıya alındığı için satın alınamaz.`
        : 'Satıcı askıya alındığı için bu işlem yapılamaz.',
      'SELLER_SUSPENDED',
      409,
    )
    this.name = 'SellerSuspendedError'
  }
}

export class SellerOnVacationError extends DomainError {
  constructor(productName?: string) {
    super(
      productName
        ? `"${productName}" mağazası geçici olarak satışa ara verdi.`
        : 'Mağaza geçici olarak satışa ara verdiği için bu işlem yapılamaz.',
      'SELLER_ON_VACATION',
      409,
    )
    this.name = 'SellerOnVacationError'
  }
}

export class ProductHasOrderHistoryError extends DomainError {
  constructor(orderLineCount: number) {
    super(
      'Sipariş geçmişi olan ürün kalıcı olarak silinemez. Ürünü yayından kaldırabilirsiniz.',
      'PRODUCT_HAS_ORDER_HISTORY',
      409,
      { orderLineCount },
    )
    this.name = 'ProductHasOrderHistoryError'
  }
}

export class SellerHasCommercialHistoryError extends DomainError {
  constructor(blockingCounts: Record<string, number>) {
    super(
      'Ticari geçmişi olan satıcı kalıcı olarak silinemez. Satıcıyı askıya alabilirsiniz.',
      'SELLER_HAS_COMMERCIAL_HISTORY',
      409,
      { blockingCounts },
    )
    this.name = 'SellerHasCommercialHistoryError'
  }
}

export class PaymentNotConfirmedError extends DomainError {
  constructor() {
    super('Ödeme henüz onaylanmadı', 'PAYMENT_NOT_CONFIRMED', 409)
    this.name = 'PaymentNotConfirmedError'
  }
}
