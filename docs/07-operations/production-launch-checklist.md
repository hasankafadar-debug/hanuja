# Production launch checklist

Canonical URL: `https://www.hanuja.com.tr`. Alt alanlar: `satici`, `admin`, `media` ve `fatura.hanuja.com.tr`.

## Zorunlu sıralama

1. VDS SSH anahtarları, firewall, otomatik güvenlik güncellemeleri ve root login politikası tamamlanır.
2. PostgreSQL, Redis, Meilisearch, ClamAV ve Coolify persistent private-document volume hazırlanır.
3. Ayrı `hanuja-media-production` R2 bucket oluşturulur; `media.hanuja.com.tr` bağlanır. Dev bucket public kalıntıları kopyalanmaz.
4. `restic` repository `rclone:gdrive:hanuja-production` olarak başlatılır. Anahtar yalnız çevrimdışı parola kasasında tutulur.
5. Uygulamalar deploy edilir; DB restore ve `pnpm db:migrate:deploy` çalıştırılır.
6. `pnpm launch:clean-data --dry-run`, sonra hedef gerçekten `hanuja_prod` ise `pnpm launch:clean-data --confirm=hanuja_prod` çalıştırılır.
7. Temizlik sonrası yalnız hero, promo ve onaylı iki blog medyası production bucket'a kopyalanır; DB URL'leri `media.hanuja.com.tr` olarak güncellenir. Production bucket envanteri elle ikinci kez kontrol edilir.
8. Post-clean DB/private-volume snapshot alınır. Anonim ve üç rol smoke testleri tamamlanır.
9. DNS öncesi Turnstile hostname allowlist, Better Auth trusted origins, Postmark inbound/outbound, R2 CORS ve iyzico callback adresleri doğrulanır.
10. Apex `hanuja.com.tr`, `hanuja.tr` ve `www.hanuja.tr`, Traefik/Coolify seviyesinde tek adımlı 301 ile `https://www.hanuja.com.tr` adresine gider.
11. Gerçek satıcı başvurur; tarama onayı ve fiziksel sözleşme aslı teslim kaydı sonrası aktifleştirilir. En az bir gerçek ürün fiyat, stok ve teslimat süresiyle yayınlanır.
12. Avukat yasal metinleri/satıcı sözleşmesini, mali müşavir fatura ve saklama matrisini yazılı onaylar; ETBİS production domain bildirimi tamamlanır. Ancak bundan sonra iyzico başvurusu gönderilir.

## Yedek ve alarm

- `tools/ops/backup-production.sh` günlük systemd timer ile çalışır; başarısız exit code alarm üretir.
- Saklama: 7 günlük, 8 haftalık, 12 aylık, 10 yıllık. Belge türü matrisi hukuk/mali müşavir kararıyla daha uzun süre belirleyebilir.
- Disk %70'te uyarı, %85'te kritik alarm üretir.
- Üç ayda bir `tools/ops/restore-drill.sh` ayrı dizin ve boş test DB üzerinde çalıştırılır. Hem bir şifreli belge hem PostgreSQL dump geri gelmeden prova başarılı sayılmaz.

## iyzico anonim smoke testi

`/hakkimizda`, `/iletisim` (KEP dahil), `/kvkk`, `/gizlilik-politikasi`, `/iade-iptal`, `/on-bilgilendirme` ve `/mesafeli-satis` 200 dönmelidir. Footer'da iyzico ile Öde, Visa ve Mastercard marka görselleri görünmelidir. Kart butonu “Siparişi Onayla ve Öde” demelidir.
