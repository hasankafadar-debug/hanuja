# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Product Page Wireframe

Bu belge, urun detay sayfasinin gorunur bilgi hiyerarsisini tanimlar.
Kaynak: `apps/web/src/app/(storefront)/urun/[slug]/page.tsx`.

## Sayfa iskeleti

1. Breadcrumb
2. Sol kolon gorsel galeri
3. Sag kolon urun bilgisi
4. Fiyat, stok ve add-to-cart
5. Guven badge modulu
6. Sekmeli detay alani

## Gorsel kolonu

- Ilk gorsel buyuk, kare ve kaliteli olmalidir
- Ek gorseller thumbnail grid ile gelir
- Gorsel yoksa kontrollu placeholder kullanilir

## Bilgi kolonu

- Ustte seller baglami
- Sonra H1
- Hemen altinda fiyat
- Sonra stok ve satin alma aksiyonu

## Guven modulu

- Ucretsiz kargo
- 14 gun iade
- Guvenli odeme

Bu alan ticari guven katmanidir; checkbox veya hukuki detay yuklemesi yapilmaz.

## Detay sekmeleri

- Aciklama
- Ozellikler
- Degerlendirmeler veya benzeri sosyal kanit alanlari

## Uygulama etkileri

- Product page, once satin alma karari icin calisir; editorial veya alakasiz link bloklari yuklenmez.
- Seller bilgisi destekleyicidir ama urun kimligini bastirmamalidir.
