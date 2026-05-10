// CORS
export {
  DEFAULT_ALLOWED_ORIGINS,
  isAllowedOrigin,
  corsHeaders,
  withCors,
  applyCorsHeaders,
} from './cors'

// Rate limiting
export {
  rateLimit,
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  SENSITIVE_RATE_LIMIT,
  HIGH_RISK_RATE_LIMIT,
} from './rate-limiter'
export type { RateLimitConfig, RateLimitResult } from './rate-limiter'

// Input validation (Zod schemas + safe parse)
export {
  slugSchema,
  ibanSchema,
  phoneSchema,
  turkishIdSchema,
  priceSchema,
  quantitySchema,
  paginationSchema,
  emailSchema,
  passwordSchema,
  loginSchema,
  registerSchema,
  cartItemSchema,
  addressSchema,
  checkoutSchema,
  sellerBankDetailSchema,
  productCreateSchema,
  shipmentEntrySchema,
  sellerRejectionSchema,
  eftApprovalSchema,
  eftRejectionSchema,
  penaltyWaiverSchema,
  returnRequestSchema,
  safeParse,
} from './input-validator'
export type { ParseResult, ParseError } from './input-validator'

// Data masking
export {
  maskIban,
  maskEmail,
  maskPhone,
  maskCustomerName,
  maskCardNumber,
  maskTurkishId,
  maskPartial,
  maskSensitiveObject,
} from './data-masker'
export {
  normalizeTurkishText,
  tokenizeNormalizedText,
  normalizedTokenSet,
  hasMatchingNormalizedTokens,
} from './turkish-normalize'

// Webhook verification
export {
  verifyWebhookSignature,
  verifyIyzicoWebhook,
  isDuplicateWebhook,
  isWebhookTimestampFresh,
} from './webhook-verifier'
export type { WebhookVerifyOptions } from './webhook-verifier'

// Fraud scoring
export { scoreOrderRisk } from './fraud-scorer'
export type { OrderRiskInput, FraudScoreResult } from './fraud-scorer'

// File validation
export {
  validateProductImage,
  validateEvidenceFile,
  sanitizeFileName,
  isStorageKeyAllowed,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_EVIDENCE_FILE_BYTES,
} from './file-validator'
export type { FileValidationResult } from './file-validator'

// Money
export { roundMoney, formatMoney } from './money'

// CSRF
export {
  generateCsrfToken,
  verifyCsrfToken,
  isOriginAllowed,
  getCsrfCookieOptions,
  getMirrorCsrfCookieOptions,
  CSRF_COOKIE_NAME,
  CSRF_MIRROR_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_BYTES,
} from './csrf'
export type { CsrfCookieOptions } from './csrf'

// Permission matrix
export {
  can,
  permissionsFor,
  assertCan,
  PermissionDeniedError,
} from './permission-matrix'
export type { UserRole, Action } from './permission-matrix'

// Audit logging
export {
  buildAuditEntry,
  auditPayoutReleased,
  auditPenaltyWaived,
  auditEftApproved,
  auditSellerSuspended,
  auditBankDetailChanged,
  auditManualFinanceAdjustment,
} from './audit-logger'
export type { AuditAction, AuditEntry, BuildAuditEntryInput } from './audit-logger'
