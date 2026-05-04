# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Schema Markup Plan

Bu belge, Hanuja storefront'ta kullanilacak JSON-LD tiplerini ve sayfa eslemelerini belirler.
Kaynaklar: `packages/seo/src/json-ld.tsx` ve `packages/seo/src/structured-data/*`.

## Temel ilke

- Yapilandirilmis veri, sayfadaki gercek icerigi tekrar eder; yeni bir iddia uretmez.
- Product, article, store ve breadcrumb verileri server-side uretilir.
- Bos, unpublished veya kullaniciyi yaniltan veri schema'ya yazilmaz.

## Mevcut ortak helper'lar

- `buildProductStructuredData`
- `buildBreadcrumbStructuredData`
- `buildOrganizationStructuredData`
- `buildArticleStructuredData`
- `buildLocalBusinessStructuredData`
- `JsonLd` React component'i

## Sayfa bazli esleme

| Sayfa tipi | Schema |
|------------|--------|
| Ana sayfa | `Organization` |
| Kategori | en az `BreadcrumbList`, ileride `CollectionPage` opsiyonel |
| Urun | `Product` + `BreadcrumbList` |
| Blog detay | `Article` + `BreadcrumbList` |
| Store | `Store` tipi local business + `BreadcrumbList` |
| Legal sayfalar | genelde schema zorunlu degil |

## Product schema kurallari

- `name`, `description`, `url`, `offers.price`, `offers.priceCurrency` zorunlu alanlardir.
- Availability bilgisi stok durumuyla uyumlu olmalidir.
- Fake discount, olmayan stok veya uydurma brand bilgisi schema'ya eklenmez.
- Fiyat numeric kalir; "KDV dahil" gibi ibareler schema yerine gorunen UI metninde verilir.

## Breadcrumb schema kurallari

- Breadcrumb yolu gercek bilgi mimarisini yansitmalidir.
- Product sayfasinda `Ana Sayfa -> Kategori -> Urun` en az seviyedir.
- `#` gibi gecersiz item URL'leri uzun vadeli cozum degildir; dynamic builder'lar temiz rota vermelidir.

## Article schema kurallari

- `headline`, `url`, `publisher`, `mainEntityOfPage` ve varsa tarih alanlari set edilmelidir.
- Excerpt yoksa schema eksik description ile yayinlanabilir; fakat blog icerigi yayin oncesi ozetle tamamlanmasi tercih edilir.
- Editor veya organization yazari gercege aykiri sekilde kisilestirilmez.

## Store schema kurallari

- Store page, seller storefront mantigini yansitir; baska seller verisini birlestiren schema kullanilmaz.
- Sehir veya iletisim gibi alanlar sadece gercek veri varsa yazilir.

## Uygulama etkileri

- Her page component'i schema'yı layout yerine kendi icinde inject etmelidir.
- Yeni schema tipi eklenecekse once ortak helper, sonra ilgili dokuman guncellenmelidir.
- `docs/04-seo/product-page-template.md` ve `docs/04-seo/collection-page-template.md` ile ayni alan adlari korunmalidir.
