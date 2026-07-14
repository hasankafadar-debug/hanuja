# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Technical SEO Spec

Bu belge, Hanuja storefront icin teknik SEO zorunluluklarini toplar.
Kaynak zinciri: `.claude/rules/04-seo-rules.md` -> `docs/04-seo/seo-url-slug-rules.md` -> `packages/seo/src/*`.

## Temel ilke

- SEO sonradan eklenen bir katman degil, route ve bilgi mimarisinin parcasidir.
- Public URL'ler deterministic, server-driven ve tek canonical mantigina bagli olmalidir.
- Search, account ve checkout gibi amac odakli sayfalar indeks kalitesini dusurmemelidir.

## Canonical kurallari

- Her public entity icin tek canonical URL vardir.
- Canonical URL'ler `packages/seo/src/canonical-builder.ts` yardimcilari uzerinden uretilmelidir.
- Query parametreli varyantlar temiz route'a canonical vermelidir.
- Cross-type canonical kullanilmaz; urun kategoriye, kategori store'a canonical vermez.
- Slug degisikligi durumunda once 301 redirect, sonra canonical ve internal link guncellemesi yapilir.

## Index ve noindex politikasi

| Sayfa tipi | Varsayilan durum |
|------------|------------------|
| Ana sayfa | index |
| Kategori (alt agacinda >=1 published urun) | index |
| Kategori (bos — alt agacinda published urun yok) | noindex, follow + sitemap disi |
| Urun | index |
| Store | index |
| Blog liste ve detay | index |
| Legal sayfalar | index |
| Search | noindex veya robots disallow |
| Cart, checkout, account, order | noindex |
| Seller ve admin panelleri | noindex |

Kategori musteri-gorunurluk kurali (launch politikasi, 2026-07): bir kategori,
kendisi veya herhangi bir alt torunu en az bir `published` urun iceriyorsa
musteriye gorunur ve indexlenir. Bos kategoriler storefront nav, `/kategori`
index sayfasi, anasayfa kartlari, footer ve sitemap'ten gizlenir; dogrudan URL
erisiminde sayfa 200 doner, bos durum mesaji gosterir ve `noindex, follow`
tasir. Urun yayinlandiginda kategori otomatik olarak gorunur ve indexlenebilir
hale gelir (ISR yenileme pencereleri icinde). Kaynak mantik:
`api/domain/category-visibility.ts` + `catalog.service.listCustomerVisibleCategories()`.
Satici/admin akislari bu kuraldan ETKILENMEZ — tam aktif agaci gormeye devam eder.

## Robots ve sitemap

- `packages/seo/src/robots-builder.ts`, `/hesabim/`, `/sepet`, `/odeme`, `/siparis/`, `/arama`, `/api/`, `/seller-panel/`, `/admin-panel/` icin disallow uretir.
- Sitemap yalnizca canonical ve indexlenebilir public rotalardan olusur.
- Sitemap entry oncelikleri `packages/seo/src/sitemap-builder.ts` ile uyumlu kalir.
- Bozuk, redirect veren veya draft icerik sitemap'e girmez.

## Pagination ve filtre kurallari

- Kategori filtreleri default olarak index kalitesine katkı saglamaz; filtreli URL'ler canonical olarak ana kategoriye donmelidir.
- Paginated category sayfalari canonical zinciri bozmayacak sekilde server-side uretilmelidir.
- Sonsuz varyasyon ureten query kombinasyonlari sitemap ve internal linking disinda tutulmalidir.

## Yapilandirilmis veri zorunluluklari

- Urun sayfalari: `Product` + `BreadcrumbList`
- Blog detaylari: `Article` + `BreadcrumbList`
- Store sayfalari: `Store` veya local business tipi + `BreadcrumbList`
- Site genelinde: `Organization`
- Category sayfalari: en azindan `BreadcrumbList`; `CollectionPage` yardimcisi eklenirse bu belge guncellenir

## Core Web Vitals hedefleri

- LCP hedefi: 2.5s altina inmek
- INP hedefi: 200ms civari veya altinda kalmak
- CLS hedefi: 0.1 altinda kalmak
- Urun ve kategori sayfalarinda hero veya ilk gorsel boyutlari server tarafinda bilinir olmalidir

## Teknik kalite kurallari

- Metadata client-side tahminle degil, server tarafinda uretilir.
- Lazy loading kararları, above-the-fold iceriğin gec yuklenmesine sebep olmamalidir.
- Soft 404 senaryolari acik olarak tanimlidir: var olmayan kategori slug'i gercek 404 doner (`notFound()`); var olan ama bos kategori 200 + bos durum + `noindex, follow` doner.
- Turkce tek dil varsayimidir; hreflang ancak ikinci dil geldikten sonra eklenmelidir.

## Uygulama etkileri

- Yeni public rota eklenirse canonical, metadata, robots ve sitemap karari ayni anda belgelenmelidir.
- `docs/04-seo/metadata-rules.md` ve `docs/02-product/sitemap.md` ile celisen bir index karari kullanilmaz.
