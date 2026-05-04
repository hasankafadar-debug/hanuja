# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Color Typography

Bu belge, Hanuja'nin uc uygulama yuzeyindeki renk ve tipografi farklarini ozetler.
Kaynaklar: `apps/web/src/app/globals.css`, `apps/seller-panel/src/app/globals.css`, `apps/admin-panel/src/app/globals.css`.

## Ortak temel

- Ana renk ailesi: koyu lacivert taban (`--color-primary`, `--color-secondary`)
- Accent: kirmizi-pembe eksen (`--color-accent`)
- Sans font: `Inter`
- Mono font: `JetBrains Mono`

## Storefront

- Display font: `Playfair Display`
- Ton: curated, warm, premium
- Arka plan: `#fafafa`
- Border ve muted tonlari daha yumusak

## Seller panel

- Display ve body ayni ailede: `Inter`
- Ton: pratik ve net
- Arka plan storefront'tan biraz daha soguk
- Radius degerleri daha sikidir

## Admin panel

- Tamamen operasyonel `Inter` hiyerarsisi
- En yogun ve kontrollu yuzey
- Border ve muted tonlari seller panelden biraz daha serttir
- Radius en sikı seviyededir

## Tipografi hiyerarsisi

- Storefront H1-H3 alanlarinda display vurgu kullanilir
- Seller ve admin tarafinda hiz ve okunurluk icin tek aile hiyerarsisi tercih edilir
- Numeric ve finansal degerler gerekiyorsa mono destekli bloklarda gosterilebilir

## Renk kullanim kurallari

- Accent, birincil aksiyon ve secili durum icin ayrilmali
- Success, warning ve destructive yalnizca gercek status anlami tasir
- Dekoratif rastgele renk kullanimi yapilmaz

## Uygulama etkileri

- Yeni bir komponent renk veya fontu hardcode etmemeli; token kullanmalidir.
- Surface farklari korunmali; storefront dili seller/admin icine aynen tasinmamalidir.
