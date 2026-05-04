# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Admin Panel Wireframe

Bu belge, admin panelinin ana navigasyon ve bilgi yogunlugu yapisini tanimlar.
Kaynak: `apps/admin-panel/src/app/(panel)/layout.tsx` ve mevcut route agaci.

## Sol sidebar yapisi

- Dashboard
- Pazar yeri: saticilar, siparisler, urun moderasyon
- Finans: odemeler, hakedisler, cezalar, finans ozeti
- Operasyon: iadeler, uyusmazliklar, denetim gunlugu
- Sistem: ayarlar

## Ust bar

- Mobilde kisaltilmis baslik
- Sagda admin kimlik veya avatar alani
- Global aksiyon yerine sayfa-bazli aksiyon modeli

## Sayfa tipleri

- Queue listesi
- Table agirlikli index sayfasi
- Detay ve aksiyon sayfasi
- Denetim ve log gorunumu

## Davranis ilkeleri

- Yüksek etkili butonlar secondary ekranlarda veya modal teyitle sunulur
- Kritik finans veya operasyon aksiyonlari status rengiyle desteklenir
- Maskelenmesi gereken veri tam acik gosterilmez

## Uygulama etkileri

- Admin yuzeyi storefront estetiğini taklit etmez; yogun ama okunakli bilgi arayuzudur.
- Yeni admin modulu eklendiginde once hangi sidebar grubuna ait oldugu netlestirilmelidir.
