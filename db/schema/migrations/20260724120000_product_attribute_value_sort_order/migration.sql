-- AlterTable
-- Tek üründe birden çok renk için görüntü sırası (Renk 1 → 0, Renk 2 → 1).
-- Additive: mevcut satırlar 0 varsayılanıyla gelir.
ALTER TABLE "product_attribute_values" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
