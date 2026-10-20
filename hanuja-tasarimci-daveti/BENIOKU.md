# Hanuja Tasarımcı Daveti — dijital broşür

Tek sayfalık, kaydırdıkça ilerleyen tanıtım sayfası. Menülerde ya da panellerde linki yoktur; tasarımcılara QR kod veya link ile ulaştırılır. Sayfa `noindex, nofollow` olarak işaretlidir, arama motorlarında görünmez.

## Klasör içeriği

- `index.html` — sayfanın kendisi
- `assets/media` — sahne, atölye, paketleme ve ürün yaşam alanı görselleri
- `assets/video` — sahne videosu (yatay + dikey) ve içerik üreticisi örnek videosu, MP4 + WebM
- `assets/panel` — gerçek tasarımcı panelinden ekran görüntüleri (mağaza, müşteri ve tutarlar örnek veridir)
- `assets/products` — hanuja.com.tr'deki Mosaiss ürün fotoğrafları
- `assets/vendor` — GSAP 3.12.5, ScrollTrigger, Lenis 1.1.13 (siteye gömülü, CDN gerekmez)
- `assets/fonts` — Plus Jakarta Sans, DM Sans, Outfit (Türkçe karakter setleriyle)
- `qr/` — sayfa adresine giden QR kodları (bej zeminli marka versiyonu ve baskı için siyah-beyaz)

## Siteye yerleştirme (Next.js)

Sayfa `https://www.hanuja.com.tr/tasarimci-daveti` adresinde çalışacak şekilde hazırlandı. Tüm dosya yolları `/tasarimci-daveti/` ile başlar.

1. Codex'in yaptığı mevcut `/tasarimci-daveti` route klasörünü kaldırın ya da yeniden adlandırın (aynı adres iki kez tanımlanmasın).
2. Bu klasörün içeriğini projede `public/tasarimci-daveti/` altına kopyalayın (`index.html`, `assets/`, istenirse `qr/`).
3. `next.config` dosyasına bir rewrite ekleyin:

```js
async rewrites() {
  return [{ source: '/tasarimci-daveti', destination: '/tasarimci-daveti/index.html' }];
}
```

4. Sayfaya site menüsünden, footer'dan ya da satıcı/admin panelinden link vermeyin. Davet yalnızca QR kod ve paylaşılan link ile yapılır.

Farklı bir adres kullanmak isterseniz `index.html` içinde `/tasarimci-daveti/` ifadesini yeni yol ile değiştirin ve QR kodu yeni adres için yeniden üretin.

## Bağlantılar

- Başvuru butonları: `https://satici.hanuja.com.tr/basvuru`
- "Önce konuşalım": `admin@hanuja.com.tr`

## Medya kaynakları

- Sahne, atölye, paketleme ve ürün yaşam alanı görselleri: Google Flow, Nano Banana 2.1
- Sahne videoları ve içerik üreticisi örnek videosu: Google Flow, Veo 3.1 Fast (1080p)
- Ürün fotoğrafları: hanuja.com.tr (Mosaiss)
- Panel görüntüleri: satici.hanuja.com.tr, örnek verilerle

## Notlar

- Komisyon oranı sayfada rakamla yazılmadı; "diğer platformlara göre düşük, oran sözleşmede yazılı" olarak anlatıldı.
- Panelde bazı metinler Türkçe karakter olmadan görünüyor (ör. "Urunlerim", "Duzenle", "Toplu Guncelle", "Acik", "Tumu", "SIPARIS", "ISLEM"). Ekran görüntülerinde düzeltildi; panelin kendisinde de düzeltilmesi önerilir.
