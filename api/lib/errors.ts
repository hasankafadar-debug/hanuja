/**
 * Domain error hierarchy.
 * All errors carry an HTTP statusCode and machine-readable code.
 * Use handleError() in api/lib/response.ts to map these to JSON responses.
 */

export class DomainError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(message: string, code: string, statusCode = 400) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.statusCode = statusCode
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

export class PaymentNotConfirmedError extends DomainError {
  constructor() {
    super('Ödeme henüz onaylanmadı', 'PAYMENT_NOT_CONFIRMED', 409)
    this.name = 'PaymentNotConfirmedError'
  }
}
