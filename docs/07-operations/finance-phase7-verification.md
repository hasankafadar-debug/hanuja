# Faz 7 — Bütünleşik doğrulama

Tarih: 2026-09-16. Durum: teknik doğrulama ve dağıtım hazırlığı; kapanış açık.

## Bulgular ve test kanıtları

Gerçek PostgreSQL kanıtları `tests/postgres/finance-atomicity.test.ts` içindedir.
Testler yalnız localhost `hanuja_finance_test` veritabanında rastgele oluşturulan
izole şemada çalışır; üretim verisi kullanılmaz.

| Başlangıç bulgusu | Kanıt grubu / doğrulama |
| --- | --- |
| Yarım hakediş/ledger, çift kesinti | `finance atomicity on PostgreSQL`: zorlanan kayıt/audit hatası, eşzamanlı iade, idempotent retry |
| Eksik satıcı hakedişi/komisyon | Aynı grup: eksik satıcı ve komisyon kurtarma, mevcut doğru kayıtların korunması |
| Muafiyet ve hakediş öncesi iade | `phase 2 refund accounting`, `phase 2 quantity lifecycle`, `phase 2 full exempt return`: tam/kısmi, kupon/EFT, çok satıcı ve 1.000 TL muaf ürün |
| Engel kalkınca ilerlememe, eski ödeme ekranı | `phase 3 payout eligibility`: banka, manuel bloke, bekleme, eşzamanlı uyuşmazlık ve audit rollback |
| Borcun ödemeden düşmemesi/çift mahsup | `phase 4 source debt offsets`: 300/1.000, 1.200/1.000, borç devri, paralel ödeme ve toplu ödeme |
| Fatura/ceza/ekstre farkları | `phase 5 invoice, penalty, and statement consistency`: satıcı sınırı, KDV, komisyon ters kaydı, ceza farkı, mahsup sonrası ceza azaltma ve CSV/XLSX kapanışı |
| Eski akışta brüt tutarın iadesi | `phase 6 legacy refund safeguards`: ödeme sınırı, 10 tarihî kanıt türü, farklı kaynak yarışı ve rollback |
| Manuel incelemeden çıkış yok | `phase 7 integrated reconciliation`: snapshot doğrulaması sonrası aynı kayıtla yeniden değerlendirme, audit rollback ve eşzamanlı tekrar |
| Kuyruk tekrarında inceleme gerekçesi kaybı | Aynı grup: `process` ve `refreshParent` finansal inceleme engelini korur |
| Kayıtlar arası mutabakat eksik | Aynı grup: EFT ve sahte kart sağlayıcısı ile gerçek DB iade tamamlama, tek çağrı, iki satıcı izolasyonu, tutarsız kayıt tespiti |

API yetki/CSRF/hız sınırı, oturumdan aktör bağlama, tutar enjeksiyonunu reddetme
ve stale/eksik kanıt yanıtları:
`tests/integration/api/admin-refund-reassessment.test.ts`.
Sağlayıcı başarı, hata ve belirsiz yanıt testleri:
`tests/unit/services/refund-processor.test.ts`,
`tests/unit/services/refund-execution.service.test.ts`.

## Açık kalan doğrulamalar

- Kullanıcı sandbox hesabı bulunmadığını/bilmediğini bildirdi. Gerçek iyzico
  sandbox tahsilat/iade testi yapılmadı; sahte sağlayıcı testleri bunun yerine
  tamamlandı sayılmaz. Üretimde gerçek para hareketi oluşturulmadı.
- Sıfır tutarlı/tarihî kanıtı çözülememiş incelemeler otomatik açılamaz.
  Kaynak banka/sağlayıcı mutabakatı gerekir; geçmiş Mosaiss verisi değiştirilmez.
- Worker ve panel sürümleri, canlı salt okunur mutabakat sonucu ve yönetim
  ekranının canlı kontrolü dağıtım sonrası kaydedilmeli. Panelleri kullanıcı dağıtır.

Bu maddeler açıkken Faz 7 ve bütün plan tamamlandı sayılmaz.

## Test paketi bakımı

Eski 6 `seller-product-import` testi, `ab0c31c` ile bilinçli kaldırılmış URL
import route'larını çağırıyordu. Bunlar kaldırılan üç endpoint ve sayfanın
kapalı kaldığını doğrulayan 4 regresyon testiyle değiştirildi. Mevcut dosya
import testleri korunuyor; URL import özelliği yeniden açılmadı.

Doğrulanan sonuçlar: 1.361 birim testi; 276 entegrasyon testi başarılı
(2 mevcut ortam koşullu test atlandı); 80 PostgreSQL testi başarılı.
Lint (7 görev), typecheck (8 görev) ve üretim build (3 panel) başarılı.
Dağıtım öncesi worker ortam ve mükerrer providerPaymentId kontrolleri temiz.
Önceki dört canlı servis `79af5e6` sürümünde doğrulandı; üç panel healthy.
Bu faz yeni migration veya URL/ortam değişikliği gerektirmez.
