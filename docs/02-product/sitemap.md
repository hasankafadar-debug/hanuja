# Son güncelleme: 2026-07-05
# Durum: taslak v2

# Sitemap

Bu belge, Hanuja'nin route ailelerini indexlenebilirlik ve sahiplik kuralina gore siniflar.
Kaynaklar `docs/04-seo/seo-url-slug-rules.md`, `packages/seo/src/sitemap-builder.ts` ve mevcut Next.js route agacidir.

## Temel namespace kurali

- Kategori: `/kategori/...`
- Urun: `/urun/...`
- Magaza: `/magaza/...`
- Blog: `/blog/...`
- Search: `/arama`

Ayni slug farkli varlik tiplerinde tekrar edebilir; ayrim namespace ile saglanir.

## Indexlenebilir public rotalar

| Rota | Durum | Not |
|------|-------|-----|
| `/` | index | ana sayfa |
| `/kategori/[...slug]` | index (kosullu) | yalnizca alt agacinda >=1 published urun olan kategoriler; bos kategoriler `noindex, follow` doner ve sitemap'e girmez |
| `/urun/[slug]` | index | canonical urun detayi |
| `/magaza/[slug]` | index | seller storefront sayfasi |
| `/blog` | index | blog liste |
| `/blog/[slug]` | index | yayinlanmis yazi |
| `/kullanim-kosullari` | index | public legal sayfa |
| `/gizlilik-politikasi` | index | public legal sayfa |
| `/kvkk` | index | public legal sayfa |
| `/iade-iptal` | index | public legal sayfa |
| `/mesafeli-satis` | index | public legal sayfa |

## Kontrollu veya noindex rotalar

| Rota | Neden |
|------|-------|
| `/arama` | query varyasyonlari ve dusuk canonical kalite |
| `/sepet` | gecici islem ekrani |
| `/odeme` | oturum ve islem bagimli checkout |
| `/hesabim` ve alti | kullaniciya ozel |
| `/siparis` ve `/siparis/[id]` | kullaniciya ozel siparis verisi |
| auth sayfalari | indexlenebilir icerik degil |
| `/seller-panel/**` | operasyon paneli |
| `/admin-panel/**` | operasyon paneli |
| `/api/**` | public arama sonucu olmamali |

## Sitemap.xml dahil etme kurali

- Sadece canonical ve indexlenebilir public URL'ler sitemap'e girer.
- Paneller, auth, cart, checkout, search ve hesap sayfalari sitemap'e girmez.
- Dynamic entry ureten yardimcilar `homeSitemapEntry`, `categorySitemapEntry`, `productSitemapEntry`, `storeSitemapEntry`, `blogSitemapEntry` ile hizalidir.
- Kategori girisleri musteri-gorunurluk kuralina tabidir: alt agacinda en az bir
  `published` urun olmayan kategori sitemap'e girmez
  (`catalog.service.listCustomerVisibleCategories()`; bkz.
  `docs/04-seo/technical-seo-spec.md` index politikasi).
- Kategori girisleri tam hiyerarsik yolu kullanir (`/kategori/ev/ev-mobilya`),
  nav ile ayni canonical formda. Duz tek-slug form sitemap'te kullanilmaz.

## Yenileme modeli (Google tarafi)

- `apps/web/src/app/sitemap.ts` canli bir URL'dir ve `revalidate = 3600` ile
  en fazla saatte bir kendini DB'den yeniden uretir. Elle yukleme, haftalik
  guncelleme veya satici kaydi basina islem YOKTUR.
- Tek seferlik kurulum: Google Search Console > Sitemaps ekranina
  `https://<domain>/sitemap.xml` bir kez gonderilir. Sonrasinda Google sitemap'i
  kendi programinda ceker ve `lastmod` alanlarina gore tarama onceligi verir.
- Google'in `google.com/ping?sitemap=` endpoint'i Haziran 2023'te kaldirildi;
  ping otomasyonu KURULMAZ. Dogru `lastmod` degerleri yeterli sinyaldir.
- `sitemap.ts` icindeki statik fallback listesi yalnizca DB hatasi durumunda
  devreye girer; guncel tutulmasi kritik degildir, hata modu icindir.

## Robots uyumu

- `packages/seo/src/robots-builder.ts` halihazirda `/hesabim/`, `/sepet`, `/odeme`, `/siparis/`, `/arama`, `/api/` icin disallow uretir.
- Sitemap kararlari robots kurallariyla celismemelidir.

## Canonical notlari

- Her public varligin tek ana URL'si vardir.
- Query parametreli varyantlar ana temiz URL'ye canonical vermelidir.
- Slug degisikliginde eski URL 301 ile yeni canonical'a tasinmalidir.

## Operasyonel not

- Bu belgede yer almayan route, ancak uygulamada public ve indexlenebilir hale geldikten sonra sitemap'e eklenmelidir.
- Ornegin ileride `/iletisim` acilacaksa once route, metadata ve canonical kurali tamamlanmali, sonra sitemap'e alinmalidir.
