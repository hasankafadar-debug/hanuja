# Müşteri kampanyaları ve iletişim izinleri

Bu teslimde e-posta ve SMS reklam kanalları kapalıdır. İYS hazırlığı kodda yapılandırılmamıştır; admin ekranında bir onay işaretlenerek aşılamaz. Resend mevcut e-posta sağlayıcısıdır. SMS sağlayıcısı ve İYS entegrasyonu bu teslimin dışında kalır.

## Gönderim kontrolü

`marketing_channel_settings` kaydı varsayılan olarak iki kanalı da kapalı tutar. Kayıt yoksa veya okunamazsa reklam gönderimi engellenir. Kanal açık görünse bile İYS bağlantısı yapılandırılmadan reklam gönderilemez. Kontrol üretim, outbox aktarımı, gönderim kapısı ve sağlayıcı çağrısından hemen önce uygulanır. Sipariş/güvenlik e-postaları, satıcı operasyon duyuruları ve fiyat geçmişi toplama devam eder.

Kapatma işlemi admin, eski/yeni değer ve zamanla denetlenir. Bekleyen outbox işleri tamamlanmış/atlanmış olarak işaretlenir; yalnız gönderime başlamamış rezervasyonlar bırakılır. Sağlayıcıya aktarılmış veya sonucu belirsiz mesajlar geri alınamaz. Eski işler yeniden açıldığında canlanmaz.

## İzin ve çıkış

Üyelikte tek, isteğe bağlı e-posta/SMS kutusu korunur; İYS aktarım süreci hazır olmadığı için devre dışıdır. Bu görünüm kesin hukuki uygunluk garantisi değildir. Hesap ayarlarında iki kanal ayrı ayrı geri çekilebilir. Eski izinler silinmez; adres kaydı `legacy_unverified` olarak aktarılır. Kullanıcının güncel e-postası, kuyruktaki adres, adres izni ve doğrulanmış İYS durumu gönderimde eşleşmelidir.

İzin olayları değişmez geçmiş olarak saklanır. Eski çıkış URL’lerinin GET isteği `/abonelikten-cik` sayfasına yönlenir; GET hiçbir izni değiştirmez. Kullanıcı düğmeye bastığında POST yapılır. RFC 8058 tek tıklamalı POST ve eski tokenlar desteklenir. Çıkış yalnız e-postayı kapatır; işlemsel iletiler devam eder.

## Admin kullanımı

`/musteri-kampanyalari` altında iki kanalın durumları ve taslakları bulunur. E-posta taslağında konu, metin, görsel veya video kapağı, Hanuja bağlantısı ve alıcı filtreleri kullanılabilir. Medya yükleme satıcı duyurularıyla ortak bileşeni kullanır. Mobil, masaüstü ve düz metin önizlemeleri gerçek müşteriye e-posta göndermez. SMS yalnız taslak olarak tutulur.

Gelecekte İYS bağlantısı tamamlandığında gönderim; içerik ve alıcıları sabitler, adres ve izinleri yeniden denetler, ortak kullanıcı başına kayan 24 saatte üç reklam e-postası sınırına katılır. Ürün bildirimlerinin yedi günlük sınırı korunur. Kampanya kapasite bekleyenleri 24 saatte sona erer. Belirsiz gönderimler otomatik yeniden denenmez. İYS/sağlayıcı bağlantısı ayrı geliştirme ve doğrulama gerektirir.

## Dağıtım

Otomatik dağıtım kapalı kalır. Dal `codex/release-2026-07-15`, Coolify kaynak SHA ayarı `HEAD` olmalıdır. Sıra: worker (eklemeli migration dahil), admin, seller, web. Seller dağıtımı ortak kampanya/izin servisleri kullanıldığı için gereklidir.

İlk merkezi engel `94ccf6e` ile ayrı dağıtıldı; worker logunda `20260925100000_marketing_channel_control` migration ve 15 işleyicinin başlatılması doğrulandı. Son pakette iki ek migration adres/olay ve müşteri kampanyası tablolarını oluşturur.

Canlı kabul: iki kanal kapalı, İYS yapılandırılmadı, SMS gönderilemez, üyelikte yeni izin kapalı, bağımsız ret ve oturumsuz çıkış kullanılabilir, worker sağlıklı. Gerçek müşterilere test reklamı gönderilmez.

## Yerel doğrulama (25 Eylül 2026)

Genel testlerde 2370 test geçti, 2 test atlandı. Gerçek PostgreSQL paketinde 149 test geçti: ortak kayan günlük sınır, paralel rezervasyon, sabitlenen içerik/alıcılar, kesin başarısız ile belirsiz sonuç ayrımı, 24 saatlik sona erme ve değişmez ret geçmişi dahil. Lint 7/7 ve typecheck 8/8 başarılıdır.

Yerel tarayıcıda üyelik kutusunun boş ve devre dışı olması, admin taslak kaydı, mobil/düz metin önizlemesi ve alıcı eleme sayıları doğrulandı. İYS doğrulaması olmayan eski izinler gönderilebilir sayılmadı. Testler gerçek müşterilere reklam göndermedi.
