-- Migration: add_eft_discount
-- Adds EFT discount fields to payments table and eft_discount to LedgerEntryType enum.

-- Add eft_discount to LedgerEntryType enum
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'eft_discount';

-- Add discount columns to payments table
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "eftDiscountAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "eftDiscountReason" TEXT;
