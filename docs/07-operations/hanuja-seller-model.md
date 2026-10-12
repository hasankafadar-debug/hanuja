# Hanuja satıcı modeli — 12.10.2026

Müşteri satışının tarafı Hanuja işletmeci şirketidir. Tasarımcı kimliği sevkiyat, tedarik ve iç inceleme için korunur. Yeni müşteri metinleri `api/lib/customer-legal-content.ts` içindeki tek kaynaktan yayımlanır; eski sipariş HTML/hash/onay kayıtları değiştirilmez.

## İletişim

İade, uyuşmazlık ve ürün sorusu mesajları `customer`, `seller` veya `internal` hedefi taşır. Müşteri/tasarımcı yazıları kendi kanallarına kaydedilir; yönetim cevabında hedef seçer. Eski hedefi olmayan mesajlar yönetim için saklanır. Tasarımcı ret gerekçeleri ve görselleri müşteriye gönderilmez; müşteri Hanuja incelemesini takip eder. Ret, yönetimin müşteri açıklamasıyla sonuçlandırılır.

## Teslim ve iade

Ürün bazlı fiili teslim tarihi `deliveredAt`, operasyon onayından bağımsızdır. Aynı siparişin son aktif ürünü teslim edilmeden yasal cayma süresi kapanmaz. Ayıp/garanti başvuruları cayma süresine bağlanmaz. Teslim öncesi cayma destek/e-posta üzerinden alınır.

İade taşıyıcısı ön bilgilendirmede belirlenmediğinden müşteriden iade taşıma masrafı istenmez. Yönetim doğrulanmış iade teslim tarihini iade detayından kaydeder. Geri ödeme son tarihi inceleme ile yeniden başlatılmaz; worker yaklaşan/geçen tarihleri yönetim bildirimlerine ekler.

## Açık takip işi: ödeme sağlayıcısı ve taksit farkı

Ödeme kuruluşu henüz seçilmedi. `installmentCount`, `installmentDifferenceAmount`, `installmentTotalAmount` alanları gelecekteki bağlantı için eklendi. EFT farkı kesin olarak sıfırdır; sağlayıcıdan doğrulanmamış kart taksit bilgisi null kalır. Taksitli seçenek ve tahmini oran tablosu açılmadı.

Entegrasyon sırasında: sağlayıcının kart/taksit teklifinden farkı alın; ödeme öncesi toplamı ve açık seçimi gösterin; kabul edilen fark/toplamı değişmez sipariş belgesine kaydedin; ödeme teyidi, kısmi/tam iade, fatura ve muhasebe karşılıklarını birlikte tamamlayın. Bu iş mevcut yayınla tamamlanmış sayılmaz.

## Yayın sırası

Eklemeli migration içeren worker önce yayımlanır; migration ve worker/scheduler doğrulanır. Bu geçişte runbook'un önerilen panel sırası yerine web → tasarımcı paneli → admin sırası kullanılır: eski okuyucular yeni hedef kitle alanını filtreleyemediği için, yeni yönetim mesajları yazılmadan önce iki katılımcı uygulamasının filtreleri etkin olmalıdır. Eski mesajlar silinmez; eski ödeme alanlarına tahmini ücret doldurulmaz.
