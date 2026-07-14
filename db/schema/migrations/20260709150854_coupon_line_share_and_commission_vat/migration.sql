-- Satır bazında satıcı kuponu payı + KDV dahil komisyon oranı (additive migration).
--
-- OrderLine.couponDiscountAmount: Order.discountAmount'ın bu satıra düşen payı.
-- Yalnızca satıcı kuponunda (Coupon.sellerId dolu) > 0 olur; platform kuponunda
-- (Coupon.sellerId null) satırlar etkilenmez ve indirim maliyeti platform tarafından
-- emilir (mevcut EFT indirimi felsefesiyle aynı). Komisyon tabanını ve net hakedişi
-- düşürür.
--
-- PlatformSettings.commissionVatRate: komisyon kesintisine uygulanan KDV oranı
-- (varsayılan %20). calculateCommission artık base × rate × (1 + vatRate) hesaplar.
--
-- Cutover: yeni formüller yalnız migration sonrası oluşturulan siparişlerde
-- snapshot'lanır. Mevcut OrderLine/Payout kayıtları dokunulmadan kalır.

ALTER TABLE "order_lines" ADD COLUMN "couponDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "platform_settings" ADD COLUMN "commissionVatRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2000;
