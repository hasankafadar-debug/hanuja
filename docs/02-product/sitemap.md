# Son güncelleme: 2026-04-18
# Durum: taslak v1

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
| `/kategori/[...slug]` | index | kategori ve alt kategori landingleri |
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
