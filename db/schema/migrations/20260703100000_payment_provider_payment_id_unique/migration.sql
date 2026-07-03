-- Payment.providerPaymentId benzersizliği:
-- Bir Iyzico paymentId birden fazla siparişi onaylayamaz (replay koruması).
-- Postgres unique index NULL değerlere izin verir; EFT ödemeleri (providerPaymentId NULL) etkilenmez.
--
-- DEPLOY ÖNCESİ KONTROL (duplicate varsa migration başarısız olur, önce elle mutabakat gerekir):
--   SELECT "providerPaymentId", count(*) FROM payments
--   WHERE "providerPaymentId" IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;

CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");
