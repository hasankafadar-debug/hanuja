-- PostgreSQL requires newly added values of an existing enum to be committed
-- before a later transaction can use them in row data.
ALTER TYPE "RefundTransactionStatus" ADD VALUE IF NOT EXISTS 'partially_completed';
ALTER TYPE "RefundTransactionStatus" ADD VALUE IF NOT EXISTS 'manual_required';
