-- Additive: closes a refund row that was created for an order that never
-- collected a payment (EFT cancelled before admin approval). Its ledger effect
-- is reversed with an offsetting entry; the row itself is kept for audit.
ALTER TYPE "RefundTransactionStatus" ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE "RefundTransactionItemStatus" ADD VALUE IF NOT EXISTS 'voided';
