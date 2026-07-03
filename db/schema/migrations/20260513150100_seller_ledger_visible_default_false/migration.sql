-- Flip ledger visibility default so that accrual entries (sale/commission/penalty)
-- are hidden from the seller statement until an invoice is issued or the payout
-- is paid. Payout entries are visible immediately because the seller needs to see
-- the actual money movement.

ALTER TABLE "seller_ledger_entries" ALTER COLUMN "visibleToSeller" SET DEFAULT false;

-- Backfill:
--   * payout entries → visible (real money movement)
--   * payout-related sale/commission accrual entries (linked via payout reference)
--     remain visible if the linked payout has already been paid; otherwise hidden
--   * sale/commission/penalty accrual entries become hidden by default
--   * if a SellerInvoice already exists for the linked order or penalty, keep
--     the accrual visible (invoice issuance unhides it).

-- Default: every accrual goes invisible
UPDATE "seller_ledger_entries"
SET "visibleToSeller" = false
WHERE "type" IN ('sale', 'commission', 'penalty');

-- Payouts are always visible to the seller
UPDATE "seller_ledger_entries"
SET "visibleToSeller" = true
WHERE "type" = 'payout';

-- Accrual entries linked to an existing SellerInvoice (commission/penalty) become visible
UPDATE "seller_ledger_entries" sle
SET "visibleToSeller" = true
WHERE sle."type" IN ('sale', 'commission')
  AND sle."referenceType" = 'payout'
  AND EXISTS (
    SELECT 1
    FROM "payouts" p
    JOIN "seller_invoices" si ON si."sellerId" = sle."sellerId"
    WHERE p."id" = sle."referenceId"
      AND si."sourceOrderId" = p."orderId"
      AND si."type" = 'commission'
  );

UPDATE "seller_ledger_entries" sle
SET "visibleToSeller" = true
WHERE sle."type" = 'penalty'
  AND sle."referenceType" = 'penalty'
  AND EXISTS (
    SELECT 1
    FROM "seller_invoices" si
    WHERE si."sellerId" = sle."sellerId"
      AND si."sourcePenaltyId" = sle."referenceId"
      AND si."type" = 'penalty'
  );

-- Sale entries belonging to orders whose payout has been paid: keep visible
UPDATE "seller_ledger_entries" sle
SET "visibleToSeller" = true
WHERE sle."type" = 'sale'
  AND sle."referenceType" = 'order'
  AND EXISTS (
    SELECT 1
    FROM "payouts" p
    WHERE p."orderId" = sle."referenceId"
      AND p."sellerId" = sle."sellerId"
      AND p."status" = 'payout_paid'
  );
