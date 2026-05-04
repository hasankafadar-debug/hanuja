# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Collection Page Template

Bu belge, kategori veya collection page'ler icin standart sayfa omurgasini belirler.
Hedef, SEO ve UX beklentisini ayni layout icinde sabitlemektir.

## Sayfa iskeleti

1. Breadcrumb
2. H1 ve kisa intro
3. Filtre ve siralama alanlari
4. Product grid
5. Pagination
6. Ilgili alt kategoriler veya ilgili icerik linkleri

## H1 ve intro kurali

- H1 yalnizca kategori adini veya kategori adina yakin net bir basligi tasir.
- Intro 2-3 cumlelik, kategoriye ozel, spam icermeyen metin olur.
- Intro metni hem kullaniciya ne bulacagini anlatir hem de kategori baglamini kurar.

## Filtre ve siralama

- Filtre UI kullanici icindir; tum filtre varyasyonlari index hedefi degildir.
- Filtre secimi canonical mantigini bozmamalidir.
- Product count ve aktif filtre durumu sayfada gorunur olmalidir.

## Grid kurallari

- Grid ustunde sayfa konusu net kalir; urun kartlari sayfanin amacini bastirmaz.
- Bos kategori durumunda soft 404 hissi yerine acik empty state kullanilir.
- Product kartlari seller adi, fiyat ve gorsel kalitesini tutarli sunmalidir.

## Metadata ve canonical

- Category metadata, `buildCategoryMetadata` ile uyumlu calismalidir.
- Canonical temiz kategori URL'si olmalidir.
- Query parametreli filtre varyasyonlari canonical rakipleri uretmemelidir.

## Structured data

- En az `BreadcrumbList` kullanilir.
- CollectionPage schema ancak kategori verisi yeterince zengin ve tutarliysa eklenir.

## Noindex veya kalite kontrol durumlari

- Bos veya gecici kategori
- Duplicate veya cok zayif intro metni
- Redirect zinciri ureten eski slug sayfasi
- Sadece filtre kombinasyonundan olusan landing

## Ic link alanlari

- Alt kategoriler
- Kardes kategoriler
- Ilgili blog yazilari
- Gerekirse secili urunler

## Uygulama etkileri

- `apps/web/src/app/(storefront)/kategori/[...slug]/page.tsx` sayfa omurgasi bu belgeye gore degerlendirilmelidir.
- Collection sayfasi, search sayfasi gibi davranmamali; ticari landing kalitesini korumalidir.
