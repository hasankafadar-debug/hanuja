# E-posta bağlantıları ve operasyon gönderimleri — 8 Ekim 2026

## Davranış

- Müşteri sipariş bağlantıları gönderim anında sipariş kimliğinden, yalnız NEXT_PUBLIC_WEB_URL kullanılarak üretilir. App-local NEXT_PUBLIC_APP_URL bu bağlantıları belirlemez.
- Kimliği olmayan eski kuyruk kayıtları yalnız bilinen Hanuja origin'lerinin beklenen sipariş yollarından çözümlenir. Yabancı host veya eksik kimlik gönderilmez; teslim kaydı açık hata taşır.
- Müşteri/satıcı/admin aksiyonları kendi origin ve mevcut sayfa yollarıyla doğrulanır. Sözleşme, soru, duyuru ve ürün bağlantıları da normalize edilir. Harici taşıyıcı takip bağlantıları korunur.
- Düzeltilmiş veri NotificationDelivery.payload içinde saklanır. Gönderilmiş mailler yeniden gönderilmez; eski mail URL'leri için yeni yönlendirme eklenmez.
- Admin EFT sipariş numarası tek # kullanır. EFT ret maili ödeme yaptıysanız destek bağlantısını gösterir.
- Satıcı ilk aktivasyonu, belge talebi ve IBAN talep/onayı iş transaction'ında outbox kaydı oluşturur; SMTP/Redis bu transaction'ı bloke etmez.
- Eski in-app-only satıcı onayı ve IBAN kayıtları stage kapısıyla in-app kalır. Yeni hakediş veya ceza e-postaları etkinleştirilmez. OTP ve şifre sıfırlama doğrudan gönderimi korunur.

## Yayın

Migration: 20261008000000_seller_documents_requested_notification yalnız NotificationType enum değerini ekler. Sıra: worker/migration gate → admin → seller → web. Her serviste NEXT_PUBLIC_WEB_URL, NEXT_PUBLIC_SELLER_PANEL_URL ve NEXT_PUBLIC_ADMIN_PANEL_URL ayrı origin olmalıdır. Public/server panel URL çiftleri aynı origin kullanmalıdır.

Dağıtım öncesi testler, gerçek izole PostgreSQL transaction/tekilleştirme testleri, typecheck, lint ve üç uygulamanın build'i tamamlanır. Canlı doğrulama mail göndermeden şablonları render ederek, migration durumunu ve servis sağlıklarını okuyarak yapılır; başarılı/belirsiz geçmiş gönderimler yeniden denenmez.
