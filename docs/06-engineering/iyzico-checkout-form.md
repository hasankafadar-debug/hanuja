# Gömülü iyzico CheckoutForm

Yerel uygulama değişikliği: 20.10.2026. Sahip, yerel inceleme sonrası 20.10.2026 tarihinde commit/push ve canlı yayın onayı verdi. Yayın sırası migration → worker → admin → web; canlı bağlantı/form kontrolleri sonrası kart satışı açılır. İlk gerçek kart/SMS adımını sahip tamamlar. Canlı anahtarlar yerel ortama alınmaz.

## Akış ve kart verisi sınırı

Kart satışı açıksa `/odeme` kartı ve uygun varsayılan teslimat adresini seçer. Varsayılan yoksa sunucunun en yeniden eskiye sıraladığı ilk teslimat adresi kullanılır. Tek, başlangıçta boş kutu iki belgeyi ayrı bağlantılarla onaylatır. Onaydan önceki gri düğme klavyeyle veya fareyle kullanılınca kırmızı uyarı gösterir; oturum açmaz.

Adres/fatura, belgeler ve Turnstile hazırsa `POST /api/payment/checkout-form/start` otomatik çağrılır. İstek yalnız `previewId`, rastgele `startKey`, gerekirse alıcı kimliği, Turnstile ve iki ayrı belge onayını alır; bilinmeyen alanları reddeder. Tutar ve taksit üst sınırı sunucuda hesaplanır. Yanıt `{orderId, attemptId, iframeUrl, expiresAt}` ve farklı sekmelerde kurtarma için mevcut denemenin gizli olmayan `startKey` değerini içerir. Kimlik numarası kart verisi değildir; eski bireysel/yabancı/kurumsal profil kısıtları korunur.

Yalnız yapılandırılmış ortamın HTTPS `sandbox-cpp.iyzipay.com` / `cpp.iyzipay.com` adresi kabul edilir; token eşleşmesi ve initialize HMAC doğrulanır. `iframe=true` eklenir. `checkoutFormContent` çalıştırılmaz. Kart sahibi, numara, SKT ve CVC Hanuja state veya API gövdesine girmez. Kart/taksit ve gerçek ödeme düğmesi iyzico alanında bulunur; Hanuja düğmesi kaldırılır. Banka doğrulaması sağlayıcının iframe akışındadır; Hanuja popup açmaz.

`forceThreeDS=1` gönderilir. Sandbox’ta sağlayıcının görünen 3DS kutusu işaretlenmeden de banka doğrulaması açılmıştır. Yine de sonuçta sunucu raporundan 3DS ayrıca kontrol edilir; doğrulanmayan tahsilat siparişi onaylamaz.

## Kanıt ve mutabakat

`CheckoutFormPreview`, stok/kupon ayırmadan sabit belge bağlamını, üretilmiş HTML’i ve belge sürümlerini saklar. Deneme bunları ve alıcı/satıcı/platform kanıtlarını aynen kopyalar; başlangıç veya tahsilatta belgeler yeniden üretilmez. Arada belge sürümü değişirse yeni onay gerekir. Sonradan seçilen taksit, fark ve tahsilat ayrı alanlara yazılır; onaylı metin yeniden düzenlenmez. Önizlemede peşin toplam, taksit farkının ve kesin toplamın iyzico’da gösterileceği açıklanır. Başarılı denemenin belge kanıtları siparişe aynen kopyalanır.

Yeni denemede `flow=checkout_form`; teklif, BIN, taksit, tahsilat ve fark başlangıçta boştur. Kategori sınırı `enabledInstallments` ile kısıtlanır ve sonuçta tekrar doğrulanır. Kalem dağıtımı mevcut iade/hakediş altyapısını kullanır; tasarımcı hakediş tutarları peşin kalır. Vade farkının müşteriye yansıması ayrıca iyzico işyeri taksit ayarına bağlıdır.

Kullanıcı kilidi, benzersiz istek/önizleme anahtarları ve sepet özeti çift rezervasyonu engeller. Yenileme, kayıp yanıt ve ikinci sekme geçerli oturumu kullanır. Sekme depolaması yalnız rastgele istek anahtarını ve sunucu özetini içerir; CF token veya kimlik/kart bilgisi içermez. Ayrılmış kuponun yeniden kullanım sayılmaması için değişmemiş sepet önce mevcut denemeden kurtarılır.

Koşullar veya onay değişirse iframe kaldırılır; `DELETE /api/payment/checkout-form/session` eski denemeyi sipariş kilidi altında geçersiz kılar. Ödenmemiş rezervasyon bir kez çözülür. Sağlayıcının açık formunu uzaktan iptal etme varsayımı yapılmaz: geç veya ikinci tahsilat deneme bazlı iptal/iade kaydına girer. Sonucu belirsiz para hareketinde kör tekrar yapılmaz.

Callback yalnız token alır. Tarayıcı mesajı yalnız sorgu tetikler; ödeme kanıtı değildir. CF sonucu HMAC ile, ödeme kimliği/konuşma/sepet/TRY/peşin fiyat/izin verilen taksit/kalem toplamlarıyla bağlanır. **Sandbox’ta banka adımı sürerken CF `FAILURE` döndürürken imzalı ayrıntılı ödeme sorgusu `INIT_THREEDS` dönebilir.** Bu nedenle CF `FAILURE`, ayrıntılı sorgu da kesin `FAILURE` demeden son durum sayılmaz. Banka iframe’i açık kalır.

V3 webhook doğrudan formatı korunur; `CHECKOUT_FORM_AUTH` için HPP sırası `secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status` olur. Önce kalıcı/benzersiz bildirim kaydı, sonra kuyruk/2xx. Worker CF oturumlarını, geç tahsilatları, kayıp bildirimleri ve iadeleri de tarar. Eski `/api/payment/start` ve `/quote` gövdeyi okumadan kapanır (kart bayrağı kapalıysa 503, açıksa 410); geçmiş 3DS callback, mutabakat ve iadeleri sürer.

## Yerel test ve yayın

Yerel test yardımcıları `.tmp/` altında; yalnız localhost `hanuja_dev` ve sandbox endpoint’i kabul eder. SMTP kapalıdır. Mevcut geliştirme Turnstile belirteci yerel arayüz testinde kullanılır; üretimin doğrulama kuralları değiştirilmez. Geçici HTTPS geçidi yalnız callback ve imzalı webhook POST yollarını kabul eder; diğer yollar 404 döner. Anahtar/token değerleri rapor veya ekran çıktısına yazılmaz.

Canlı iyzico API/secret/base URL ayarları web ve worker yanında adminin kart iadesi mutabakat uçlarında da gerekir; üç serviste aynı canlı hesap, yalnız runtime olarak yapılandırılır. Yeni kart satışı bayrağı yalnız webdedir.

Onaylanan yayın sırası: migration → worker → admin → web; sonrasında canlı sağlık/kart kapalı kontrolleri. Gerçek kart/SMS adımını sahip yapar. Yeni ödeme bayrağı geri alınabilir; başlamış ödemelerin callback, mutabakat ve iadeleri kapanmaz. PCI kapsamı iframe ile azalabilir; bu belge PCI uygunluk sertifikası veya tüm yükümlülüklerden muafiyet iddiası değildir.

Kaynaklar: [CF iframe](https://docs.iyzico.com/odeme-metotlari/odeme-formu/cf-entegrasyonu), [yanıt imzaları](https://docs.iyzico.com/ek-servisler/imza-yanitinin-dogrulanmasi), [HPP webhook](https://docs.iyzico.com/ek-servisler/webhook), [test kartları](https://docs.iyzico.com/ek-bilgiler/test-kartlari).
