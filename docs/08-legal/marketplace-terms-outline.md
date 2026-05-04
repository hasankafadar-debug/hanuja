# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Marketplace Terms Outline

Bu belge, Hanuja kullanicilarina sunulacak platform kullanim kosullari icin calisma iskeletidir.
Nihai metin degil; hukuk incelemesi, sirket bilgileri ve yayin dili sonradan netlestirilmelidir.

## Belgenin amaci

- Hanuja'nin araci pazar yeri rolunu acik tanimlamak
- Merkezi tahsilat modelinin hukuki dilini tutarli hale getirmek
- Musteri, satici ve admin sorumluluklarini ayni cercevede toplamak
- Kod tarafindaki siparis, iade, ceza ve payout kurallariyla celismeyen bir temel olusturmak

## Platform tanimi

- Hanuja, ev, ofis, dekor ve yasam urunlerine odaklanan Turkiye merkezli bir pazar yeridir.
- Musteri odemesi Hanuja uzerinden alinir; siparisin satisi ve fiziksel ifasi ilgili satici tarafindan yerine getirilir.
- Hanuja, odeme akisini, siparis orkestrasyonunu, risk kontrollerini ve operasyonel denetimi yonetir.
- Platform, her bir urunun saticisinin ayrica tanimlandigi bir cok saticili modelle calisir.

## Kullanici gruplari

| Grup | Temel hak | Temel yukumluluk |
|------|-----------|------------------|
| Musteri | Urunleri inceleme, satin alma, siparis takibi, iade talebi | Dogru bilgi verme, kotuye kullanimdan kacinma |
| Satici | Katalog yayinlama, odemesi onayli siparisi gorme, payout alma | Dogru urun bilgisi, zamaninda fulfilment, politika uyumu |
| Admin | Operasyon, odeme, risk ve uyusmazlik denetimi | Gerekceli islem, audit log, yetki sinirina uyum |

## Musteri yukumluluklari

- Hesap acarken ve siparis verirken dogru kimlik, iletisim ve teslimat bilgisi saglanmalidir.
- Odeme araclarini hukuka uygun ve kendi yetkisi dahilinde kullanmalidir.
- Hileli iade, kupon suistimali, sahte yorum, coklu hesap manipulasyonu ve benzeri davranislar yasaktir.
- Teslimat onayi, iade talebi ve uyusmazlik basvurulari gercege uygun bilgiyle yapilmalidir.

## Satici yukumluluklari

- Katalog girdileri, fiyat, stok, gorsel ve aciklama alanlari gercegi yansitmalidir.
- Yasakli urun, aldatıcı beyan, sahte stok veya gercek disi kampanya yayinlanamaz.
- Odemesi onaylanmamis siparis saticiya gosterilmez; satici yalnizca `payment_confirmed` veya EFT onayli siparisleri isler.
- Siparis, standart olarak 20 gun icinde fulfil edilmelidir; takip numarasi girilmeden `shipped` durumuna gecilemez.
- Satici reddi, 20 gun asimi, iade sonrasi borc ve diger finansal etkiler seller ledger kayitlarina islenebilir.

## Ucretler ve ticari kosullar

- Komisyon kural zinciri `product override -> category rate -> seller general rate -> system default` sirasini izler.
- Reklam ve servis ucretleri komisyondan ayridir; ayri ledger ve payout satiri olarak ele alinir.
- Urun satis faturasi saticiya, platform servis faturasi ise Hanuja tarafindan duzenlenir.
- Hanuja net payout hesaplamasinda komisyon, cargo charge, penalty, ad fee, refund offset ve diger finansal kayitlari mahsup edebilir.

## Siparis ve fulfilment kosullari

- Siparis akisi `payment_confirmed` ile satici tarafina acilir.
- `delivered` ile `delivery_confirmed` ayni sey degildir; payout geri sayimi yalnizca `delivery_confirmed` ile baslar.
- Musteri kargoya verilmeden once iptal talep edebilir; kargolanan siparisler iade veya uyusmazlik akisina girer.
- 14 gunluk cayma hakki ayri, uyusmazlik akisi ayri tutulmalidir.

## Ceza ve uyum maddeleri

- Standart satici cezasi urun tutarinin yuzde 20'sidir.
- Ceza, tipik olarak saticinin odemeli siparisi reddetmesi veya 20 gunluk fulfilment taahhudunu ihlal etmesi halinde devreye girer.
- Istisna veya waiver kararlari yalnizca yetkili admin tarafindan, gerekce ve audit log ile alinabilir.
- Ceza kaydinin varligi, waive edilse dahi operasyonel gecmisin parcasidir.

## Iptal, iade ve uyusmazlik

- Kargoya cikmamis siparislerde iptal ile kargo sonrasi iade akisi birbirinden ayrilmalidir.
- 14 gunluk cayma hakki hizli yol olarak tanimlanir.
- 14 gun sonrasindaki talepler otomatik degil, admin degerlendirmesine baglidir.
- Uyusmazlik acildiginda payout bloklanir ve karar kaydi tutulur.

## Hesap sonlandirma ve erisim kisiti

- Platform, politika ihlali, dolandiricilik supheleri, sahte icerik, tekrar eden fulfilment ihlalleri veya hukuki zorunluluk halinde hesabi kisitlayabilir.
- Satici hesabinin kapanmasi, acik borc, bekleyen iade veya payout bloklarini ortadan kaldirmaz.
- Musteri hesabi kotuye kullanim veya yasal zorunluluk halinde askiya alinabilir.

## Sorumlulugun cercevesi

- Hanuja, platform altyapisini, odeme orkestrasyonunu ve operasyonel denetimi saglar.
- Satici, urunun tanimi, mevzuata uygunlugu, stok dogrulugu, teslimat ifasi ve urun bazli faturalama bakimindan asil sorumludur.
- Bu ayrim final hukuki metinde daha acik bir sorumluluk dagilimi ve zorunlu tuketici hukuku ifadeleriyle tamamlanmalidir.

## Uygulanacak hukuk ve yetkili yer

- Taslak varsayim, Turk hukuku ve Istanbul yetkili mahkemeleri/cra daireleri dilidir.
- Sirket ticaret unvani, MERSIS, vergi dairesi, adres ve iletisim bilgileri yayindan once tamamlanmalidir.

## Uygulama etkileri

- Platform tanimi, legal sayfalardaki diger metinlerle ayni dilde tekrar edilmelidir.
- Ceza, payout hold, iade ve uyusmazlik kurallari mevcut `docs/01-business` ve `docs/07-operations` kararlarini bozmayacak sekilde yazilmalidir.
- Checkout, signup ve footer linkleri bu metinle ayni rota ailesine baglanmalidir.
