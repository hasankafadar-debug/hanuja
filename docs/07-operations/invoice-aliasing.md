# Sipariş fatura adreslerinin kaldırılması

14.10.2026 itibarıyla siparişe özel pf…@fatura.hanuja.com.tr adresleri kullanılmaz. Tasarımcı faturayı panelden Hanuja'ya yükler. Hanuja'nın müşteriye satış faturası ve tasarımcıya iade faturası ayrı özel belgelerdir.

Alias üretimi, panel alanları, backfill komutu, Postmark fatura endpoint'i ve Resend gelen PDF endpoint'i kaldırılmıştır. Tarihî alias satırları retired olarak korunur; tarihî fatura, muhasebe ve denetim kayıtları silinmez.

Yayın sırası: worker/migration, admin-panel, seller-panel, web. Yeni check-env ve kod yayımlandıktan sonra INVOICE_ALIASING_ENABLED, INBOUND_EMAIL_DOMAIN, RESEND_RECEIVING_API_KEY ve RESEND_INBOUND_WEBHOOK_SECRET kullanılmıyorsa servislerden kaldırılır. Eski kod yayındayken önceden kaldırmayın.

POSTMARK_INBOUND_WEBHOOK_USER ve POSTMARK_INBOUND_WEBHOOK_PASS korunur: /api/inbound/postmark/store-discount RET abonelikten çıkışını çalıştırır. Resend gönderim/teslimat webhook'u, SMTP değişkenleri ve gönderim kimlik bilgileri korunur. Canlı gelen-posta yönlendirmesi ve Cloudflare değişiklikleri kullanıcı yayın iznine tabidir.
