# Hanuja sipariş akışı yayın kontrolü

Bu görevde commit, push, deploy ve canlı Cloudflare değişikliği için yerel kabul raporundan sonra kullanıcı izni gerekir. Bu dosya yayın yapıldığını göstermez.

## Sıra ve kayıtların korunması

1. Görev dosyalarının izin listesi ve dört servisin mevcut dal/commit bilgileri doğrulanır. Yerel ortam dosyaları, test oturumları, çıktılar, parolalar ve build dosyaları yayımlanmaz.
2. Eski worker durdurulur; sessiz teslim onayı işi çalışırken sürüm değiştirilmez. Veritabanı yedeğinden sonra `20261014120000_simplified_order_workflow` migration'ı worker ortamında uygulanır. Migration eski fatura kayıtlarını silmez; aktif e-posta adreslerini emekliye ayırır ve ayrı iade faturası tablosunu ekler.
3. Sıra: worker/migration → admin → tasarımcı → web. Yeni scheduler eski `delivery-silent-confirmation` tekrarlarını ve bekleyen işleri kaldırır. Gecikme görevi yalnız süre/risk takibi yapar.
4. Yeni kod ve yayın kontrolü kurulduktan sonra kullanılmayan alias değişkenleri temizlenir. Postmark RET endpoint'i `/api/inbound/postmark/store-discount`, ortak Basic Auth kullanıcı/parolası ve Resend teslimat webhook'u korunur. DNS/mail kayıtları değiştirilmez.
5. Eski otomatik süre iptalleri ve gecikme cezaları yalnız sayım/raporla incelenir. Geçmiş sipariş, stok, ceza, cari ve muhasebe kayıtları topluca düzeltilmez.
6. Dört servis yeni sürümdeyken aktif `order_email_aliases` sayısı yeniden okunur. Eski web sürümünün geçiş sırasında açtığı adres varsa yalnız bu emekli adreslerin durumları migration ile aynı şekilde `retired` yapılır; belgeler ve mali kayıtlar değiştirilmez. Aktif adres sayısı sıfır doğrulanır. Migration ayrıca eski geçmişte eksik olan `fulfillment_warning_5days` enum değerini güvenli biçimde ekler.

## Özel medya — yalnız yayın izni sonrasında

Bucket'ın bağlı bütün alan adları ve mevcut WAF kuralları önce salt okunur kaydedilir. Yalnız `media.hanuja.tr` varsa aşağıdaki kural onun zone'una eklenir; başka etkin bucket alan adı varsa aynı koruma onun için de tamamlanmadan özel yollar kapatılmış sayılmaz. Mevcut kurallar değiştirilmeden yeni bir **Block** kuralı eklenir:

```text
http.host eq "media.hanuja.tr" and (
  not (
    starts_with(http.request.uri.path, "/products/") or
    starts_with(http.request.uri.path, "/stores/") or
    starts_with(http.request.uri.path, "/avatars/") or
    starts_with(http.request.uri.path, "/blog/") or
    starts_with(http.request.uri.path, "/slider/") or
    starts_with(http.request.uri.path, "/promo/") or
    starts_with(http.request.uri.path, "/general/") or
    starts_with(http.request.uri.path, "/announcements/")
  ) or
  http.request.uri.path contains "%" or
  http.request.uri.path contains ".." or
  http.request.uri.path contains "\\"
)
```

Bu liste `api/lib/media-url.ts` içindeki herkese açık klasörlerle aynıdır. `returns/`, `disputes/`, `documents/`, `customer-support/` ve bilinmeyen klasörler doğrudan sunulmaz. Uygulamanın kimlik denetimli `/api/media/private/{id}` akışı ve sunucunun imzalı S3 erişimi çalışmaya devam eder. Faturalar özel belge deposunda kalır; tarihî R2 belgeleri sunucu üzerinden okunur.

R2 bucket Settings → Public Development URL bölümünde `r2.dev` erişimi **Disable** yapılır. Custom domain erişimi ürün medyası için açık kalır. WAF custom domain üzerinde çalışır; `r2.dev` ayrı bir erişim yoludur ve ayrıca kapatılmalıdır. Kaynak: [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [WAF custom rules](https://developers.cloudflare.com/waf/custom-rules/).

Canlı kontrolde kişisel veri içermeyen, bu sürüme özgü bir özel erişim kontrol dosyası kullanılabilir. Doğrudan özel URL, eski `r2.dev` URL'si, kodlanmış yol ve genel medya proxy'si üzerinden erişim engellenmeli; yetkili sunucu okuması ve bilinen bir ürün görseli başarılı olmalıdır. Yalnız bu kontrol dosyası kaldırılır. Özel yolların geçmiş cache kayıtları temizlenir; ürün medyası silinmez.

## Yayın sonrası

Dört servisin çalışan commit'i, migration, API health, RET endpoint'i, özel belge sahipliği ve ürün görselleri kontrol edilir. En az 15 dakika hata logları, outbox/BullMQ kuyrukları ve mail teslimatları izlenir. Belirsiz SMTP sonucu otomatik tekrar gönderilmez; mevcut admin mail inceleme/yeniden deneme akışı kullanılır.
