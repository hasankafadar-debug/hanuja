# Hanuja satıcı modeli — 12.10.2026

Müşteri satışının tarafı Hanuja işletmeci şirketidir. Tasarımcı kimliği sevkiyat, tedarik ve iç inceleme için korunur. Yeni müşteri metinleri `api/lib/customer-legal-content.ts` içindeki tek kaynaktan yayımlanır; eski sipariş HTML/hash/onay kayıtları değiştirilmez.

## İletişim

İade, uyuşmazlık ve ürün sorusu mesajları `customer`, `seller` veya `internal` hedefi taşır. Müşteri/tasarımcı yazıları kendi kanallarına kaydedilir; yönetim cevabında hedef seçer. Eski hedefi olmayan mesajlar yönetim için saklanır. Tasarımcı ret gerekçeleri ve görselleri müşteriye gönderilmez; müşteri Hanuja incelemesini takip eder. Ret, yönetimin müşteri açıklamasıyla sonuçlandırılır.

## Teslim ve iade

Ürün bazlı fiili teslim tarihi `deliveredAt`, operasyon onayından bağımsızdır. Aynı siparişin son aktif ürünü teslim edilmeden yasal cayma süresi kapanmaz. Ayıp/garanti başvuruları cayma süresine bağlanmaz. Teslim öncesi cayma destek/e-posta üzerinden alınır.

İade taşıyıcısı ön bilgilendirmede belirlenmediğinden müşteriden iade taşıma masrafı istenmez. Yönetim doğrulanmış iade teslim tarihini iade detayından kaydeder. Geri ödeme son tarihi inceleme ile yeniden başlatılmaz; worker yaklaşan/geçen tarihleri yönetim bildirimlerine ekler.

## Ödeme sağlayıcısı ve taksit farkı (2026-10-16)

Ödeme kuruluşu iyzico (standart sanal POS, 3D Secure, kendi ödeme formumuz). Taksit farkını müşteri öder:
seçenekler iyzico'nun taksit sorgusundan gelir, ödeme öncesi toplam ve seçim gösterilir, kabul edilen fark ve
toplam onaylanan denemenin sözleşmesiyle `OrderLegalSnapshot`'a yazılır. Onay, kısmi/tam iade (vade farkı payı
oransal iade edilir) ve iyzico kesintisinin ayrı izlenmesi uygulandı; bkz. `docs/05-security/payment-security.md`.
EFT farkı kesin olarak sıfırdır.

Kart satışı `IYZICO_CARD_PAYMENTS_ENABLED` ile kapalıdır. Açılmadan önce: iyzico'nun PCI DSS şartı, webhook V3
aktivasyonu, panel taksit oranları ve mali müşavirin vade farkı fatura/KDV onayı tamamlanmalıdır.

## Yayın sırası

Eklemeli migration içeren worker önce yayımlanır; migration ve worker/scheduler doğrulanır. Bu geçişte runbook'un önerilen panel sırası yerine web → tasarımcı paneli → admin sırası kullanılır: eski okuyucular yeni hedef kitle alanını filtreleyemediği için, yeni yönetim mesajları yazılmadan önce iki katılımcı uygulamasının filtreleri etkin olmalıdır. Eski mesajlar silinmez; eski ödeme alanlarına tahmini ücret doldurulmaz.
