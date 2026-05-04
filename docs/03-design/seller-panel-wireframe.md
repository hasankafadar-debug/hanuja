# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Seller Panel Wireframe

Bu belge, seller panelinin ana bilgi mimarisini ve ekran karakterini tanimlar.
Kaynak: `apps/seller-panel/src/app/(panel)/layout.tsx` ve mevcut route agaci.

## Sol sidebar yapisi

- Kontrol paneli
- Katalog: urunlerim
- Siparisler: siparisler, kargolar, iadeler
- Finans: odemeler ve hakedis
- Magaza: ayarlar

## Ust bar

- Mobilde sade baslik
- Sagda seller display name ve avatar
- Genel gorunum, operasyonel berrakligi oncelemelidir

## Sayfa tipleri

- Dashboard ozeti
- Product list ve edit akisi
- Order list ve detay
- Shipment girisi
- Return ve finance gorunumu

## Davranis ilkeleri

- Saticiya gosterilen veri aksiyon dogurur nitelikte olmali
- Odemesi onaysiz siparis gosterilmez
- Penalty, payout hold ve negatif bakiye gibi kavramlar acik acik yazilmalidir

## Uygulama etkileri

- Seller panel, admin panel kadar yogun degil ama storefront kadar duygusal da degildir.
- Yeni sayfalar, mevcut sidebar yapisina ve tekil operasyon akislara uyumlu tasarlanmalidir.
