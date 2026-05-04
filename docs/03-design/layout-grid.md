# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Layout Grid

Bu belge, Hanuja yuzeylerinde kullanilan temel layout ve spacing mantigini sabitler.

## Storefront container modeli

- Ana container genellikle `max-w-7xl`
- Yatay padding mobilde dar, desktop'ta genisler
- Header, footer ve ana section'lar ayni merkez eksenini paylasir

## Storefront section ritmi

- Hero ve CTA gibi buyuk bloklar icin genis dikey bosluk
- Product ve category grid alanlari icin orta seviye section spacing
- Ayni sayfa icinde arka plan tonu degistiren section'larla hiyerarsi kurulur

## Category ve product layout

- Category sayfasi: ana icerik + filtre kolon ayrimi
- Product sayfasi: iki kolonlu ana grid
- Mobilde kolonlar dikey akisa doner

## Seller panel layout

- Sol sidebar: yaklasik 56 birim genislik
- Sabit top bar
- Ic sayfada kart ve tablo agirlikli akıs

## Admin panel layout

- Sol sidebar: seller panelden biraz daha genis, yaklasik 60 birim
- Table ve queue ekranlari icin genis ana kolon
- Detay ekranlarinda liste + aksiyon bloklari ayrimi

## Spacing ilkeleri

- Card ic bosluklari tek sistemle korunur
- Farkli yuzeylerde padding rasgele degismez
- Dar panellerde bilgi yogunlugunu artırmak icin radius ve spacing sikilasabilir

## Uygulama etkileri

- Yeni page layout'lari var olan container ve sidebar mantigini bozmadan kurulmalidir.
- Seller/admin tarafinda storefront tipi tam-genis editorial bloklar kullanilmaz.
