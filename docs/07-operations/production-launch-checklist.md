# Production launch checklist

Canonical URL: `https://www.hanuja.com.tr`. Alt alanlar: `satici`, `admin`, `media` ve `fatura.hanuja.com.tr`.

## Zorunlu sıralama

1. VDS SSH anahtarları, firewall, otomatik güvenlik güncellemeleri ve root login politikası tamamlanır.
2. PostgreSQL, Redis, Meilisearch, ClamAV ve Coolify persistent private-document volume hazırlanır.
3. Mevcut `hanuja-media` R2 bucket'ının envanteri ve yalnız bu bucket'a kapsamlı token yetkisi doğrulanır; yeni bucket oluşturulmaz veya bucket'lar arasında medya kopyalanmaz. `media.hanuja.tr` bu bucket'a bağlıdır. Cloudflare DNS işlemleri yalnız `hanuja.tr` zone'unda yapılır; `hanuja.com.tr` DNS ve mail kayıtları değiştirilmez.
4. `restic` repository `rclone:gdrive:hanuja-production` olarak başlatılır. Anahtar yalnız çevrimdışı parola kasasında tutulur.
5. DB restore/yedek doğrulaması tamamlanır; worker deploy edilir ve başlangıç kapısındaki `pnpm db:migrate:deploy` başarılı olduktan sonra admin, seller-panel ve web deploy edilir.
6. `pnpm launch:clean-data --dry-run`, sonra hedef gerçekten `hanuja_prod` ise `pnpm launch:clean-data --confirm=hanuja_prod` çalıştırılır.
7. Temizlik sonrası mevcut `hanuja-media` bucket envanterinde beklenen hero, promo ve onaylı iki blog medyası elle doğrulanır; kopyalama yapılmaz. Yeni URL'ler `media.hanuja.tr` kullanır; eski `media.hanuja.com.tr` URL'leri runtime uyumluluğuyla çalıştığı için DB URL backfill'i yapılmaz.
8. Post-clean DB/private-volume snapshot alınır. Anonim ve üç rol smoke testleri tamamlanır.
9. DNS öncesi Turnstile hostname allowlist, Better Auth trusted origins, Postmark inbound/outbound, R2 CORS ve iyzico callback adresleri doğrulanır.
10. Apex `hanuja.com.tr`, `hanuja.tr` ve `www.hanuja.tr`, Traefik/Coolify seviyesinde tek adımlı 301 ile `https://www.hanuja.com.tr` adresine gider.
11. Gerçek satıcı başvurur; tarama onayı ve fiziksel sözleşme aslı teslim kaydı sonrası aktifleştirilir. En az bir gerçek ürün fiyat, stok ve teslimat süresiyle yayınlanır.
12. Avukat yasal metinleri/satıcı sözleşmesini, mali müşavir fatura ve saklama matrisini yazılı onaylar; ETBİS production domain bildirimi tamamlanır. Ancak bundan sonra iyzico başvurusu gönderilir.

## Yedek ve alarm

- KYC uploads never use R2 or a CDN. Configure the same persistent host path, `/var/lib/hanuja/private-documents`, at that exact container path in both `hanuja-seller` and `hanuja-admin`. The host directory owner must be UID/GID `1001:1001`, with mode `0700`.
- Set the same `PRIVATE_DOCUMENT_ROOT=/var/lib/hanuja/private-documents` and same 32-byte base64 `PRIVATE_DOCUMENT_ENCRYPTION_KEY` Coolify secret in both applications. Never commit or add that key to the backup environment file; retain it only in the password vault.
- Cutover policy for any old R2-backed KYC row: it is fail-closed, cannot be viewed or approved, and the seller must upload a replacement. After the encrypted replacement is persisted, its old R2 object and row are deleted; no legacy document is copied into the new store.
- `tools/ops/backup-production.sh` backs up both PostgreSQL and the encrypted private-document volume to `rclone:gdrive:hanuja-production`. The Google Drive copy therefore contains encrypted document bytes, not plaintext KYC files.
- Install the `tools/ops/systemd/` unit, timer, and environment-file template on the host, then enable `hanuja-production-backup.timer`. The unit intentionally runs as `root`, so it can read the UID `1001` / mode `0700` private volume without weakening application permissions; failed service runs must alert through host monitoring.

- `tools/ops/backup-production.sh` günlük systemd timer ile çalışır; başarısız exit code alarm üretir.
- Saklama: 7 günlük, 8 haftalık, 12 aylık, 10 yıllık. Belge türü matrisi hukuk/mali müşavir kararıyla daha uzun süre belirleyebilir.
- Disk %70'te uyarı, %85'te kritik alarm üretir.
- Üç ayda bir `tools/ops/restore-drill.sh` ayrı dizin ve boş test DB üzerinde çalıştırılır. Hem bir şifreli belge hem PostgreSQL dump geri gelmeden prova başarılı sayılmaz.

## iyzico anonim smoke testi

`/hakkimizda`, `/iletisim` (KEP dahil), `/kvkk`, `/gizlilik-politikasi`, `/iade-iptal`, `/on-bilgilendirme` ve `/mesafeli-satis` 200 dönmelidir. Footer'da iyzico ile Öde, Visa ve Mastercard marka görselleri görünmelidir. Kart butonu “Siparişi Onayla ve Öde” demelidir.
