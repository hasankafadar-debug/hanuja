-- No-op: the gross_invoice_amount safe-backfill has been consolidated into
-- the original 20260513131821_seller_invoice_vat_ledger_types migration so
-- that the column is added nullable, backfilled, and set NOT NULL in a single
-- self-contained step. This file is intentionally left as a placeholder to
-- preserve migration history; it makes no schema changes.

SELECT 1;
