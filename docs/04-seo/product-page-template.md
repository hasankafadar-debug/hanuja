# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Product Page Template

Bu belge, Hanuja urun detay sayfalarinin sabit bilgi mimarisini tanimlar.
Urun sayfasi hem ticari karar sayfasi hem de SEO landing sayfasidir.

## Sayfa iskeleti

1. Breadcrumb
2. Gorsel galeri
3. Seller adi ve urun basligi
4. Fiyat ve stok
5. Add to cart
6. Guven bloklari
7. Aciklama ve ozellik sekmeleri
8. Ilgili kategori veya urun linkleri

## Baslik kurali

- H1 benzersiz urun adidir.
- Kategori adini gereksiz yere tekrar eden keyword yiginlarina izin verilmez.
- Seller icin ayrica baglam verilir ama H1 seller vitrini haline getirilmez.

## Gorsel kurallari

- Ilk gorsel above-the-fold alanda kaliteli ve boyutu belirli olmalidir.
- Alt text, dosya adi degil urunu anlatan metin olmali.
- Placeholder gorsel sadece gercek gorsel yoksa kullanilir.

## Fiyat ve guven bilgisi

- Fiyat numeric ve acik gosterilir.
- KDV dahil ibaresi is modeline gore zorunluysa fiyat alanina yakin konumlandirilir.
- Stok, iade ve guvenli odeme mesajlari ayni modulde toplanabilir.

## Icerik bloklari

- Kisa ozet veya ana description
- Ozellikler ve temel attribute'lar
- Bakim, materyal veya boyut bilgisi varsa ayrik sunum
- Seller veya teslimat baglami gerektiginde ek bilgi

## Metadata ve canonical

- `buildProductMetadata` source of truth'tur.
- Canonical her zaman `/urun/[slug]` olur.
- Variant veya query tabanli alternatif URL'ler canonical rakipleri olusturmaz.

## Structured data

- `Product` schema zorunludur.
- `BreadcrumbList` schema zorunludur.
- Stock ve price alanlari UI ile ayni veri kaynagindan gelmelidir.

## Noindex veya yayin disi durumlar

- Unpublished urun
- Gecersiz slug
- Sadece placeholder aciklamaya sahip ve yayinlanmamasi gereken seller icerigi

## Uygulama etkileri

- `apps/web/src/app/(storefront)/urun/[slug]/page.tsx` icindeki seller, stok, fiyat ve tab yapisi bu belgeyle uyumlu kalmalidir.
- Urun sayfasi, blog veya kategori icin ikincil landing'e donusturulmez; once urun karari desteklenir.
