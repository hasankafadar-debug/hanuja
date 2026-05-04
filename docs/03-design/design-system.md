# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Design System

Bu belge, Hanuja tasarim sisteminin token, component ve surface katmanlarini ozetler.
Kaynaklar: `apps/*/src/app/globals.css`, `packages/ui/src/index.ts`, `.claude/rules/03-ui-design-system.md`.

## Token mantigi

- Renk, tipografi ve radius degerleri CSS custom property ile tanimlanir
- Component dosyalarinda sabit renk veya font degeri hardcode edilmez
- Brand swap senaryosu token seviyesinde cozulecek sekilde dusunulur

## Surface farklari

- Storefront en duygusal ve display tipografili yuzeydir
- Seller panel daha sik ve operasyonel varyanttir
- Admin panel en yogun ve en kontrollu varyanttir

## Component sistemi

- Base component'ler ortak primitives katmanidir
- Composite component'ler sayfa duzeyi kaliplari tasir
- Ayni semantic amac icin farkli component adlari cikarilmaz

## Form ve durum sistemi

- Form alanlari label, hata ve yardim metniyle birlesik dusunulur
- Status'ler renk + yazi + badge veya icon ile iletilir
- Toast ve dialog gibi geri bildirimler kritikligi oraninda kullanilir

## Navigation sistemi

- Storefront navigasyonu kesif odaklidir
- Seller ve admin navigasyonu sidebar agirliklidir
- Breadcrumb sadece gercek hiyerarsiyi gosterdigi yerde kullanilir

## Uygulama etkileri

- Yeni UI, once token ve mevcut component ailesi icinde cozulmeye calisilir.
- Yuzeyler arasi farklar kaybolacak kadar tek tiplesen tasarim tercih edilmez.
