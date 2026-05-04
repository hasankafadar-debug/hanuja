# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Category Page Wireframe

Bu belge, kategori sayfasinin urun listeleme ve landing sayfasi olarak birlikte nasil davranacagini tanimlar.
Kaynak: `apps/web/src/app/(storefront)/kategori/[...slug]/page.tsx`.

## Sayfa iskeleti

1. Breadcrumb
2. Kategori basligi ve urun sayaci
3. Filtre sidebar
4. Sort bar
5. Product grid
6. Pagination veya bos durum

## Ust alan

- Breadcrumb bilgi mimarisini net gostermelidir
- H1 kategori adini tasir
- Kisa sayaç veya sonuc bilgisi H1 altinda yer alir

## Filtre alanı

- Sol kolon veya mobil drawer mantigi
- Fiyat ve stok gibi filtreler acik okunur etiketlerle sunulur
- Filtre secimleri landing hissini bozmaz; sayfayi "search results" ekranina cevirmemelidir

## Sort bar

- Sonuc adedi
- Varsayilan siralama
- Yeni, fiyat artan ve fiyat azalan gibi sinirli secenekler

## Grid davranisi

- Desktop'ta 3-4 kolon, mobilde tek kolon veya rahat iki kolon
- Urun kartlari seller, fiyat ve gorsel dengesini korur
- Grid, sayfanin ana odagi olmali; filtre ve sort ikincil kalmalidir

## Empty state

- "Urun yok" ifadesi tek basina birakilmaz
- Filtreyi temizle veya baska kategoriye git gibi yonlendirme verilir

## Uygulama etkileri

- Kategori sayfasi, SEO ve conversion icin bir landing'dir; tablo veya asiri yogun operasyon dili kullanilmaz.
- Ilgili alt kategoriler veya editorial linkler eklenecekse grid altinda ikincil blok olarak konumlanmalidir.
