# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Payment Regulation Notes

Bu belge, Hanuja'nin merkezi tahsilat modelinin odeme mevzuati acisindan tasidigi riskleri ozetler.
Amac, urunu lisansli odeme kurumu gibi konumlandirmadan Iyzico etrafinda dogru teknik ve hukuki sinirlari belirlemektir.

## Temel risk sorusu

- Hanuja, musteri odemesini kendi adina mi yoksa lisansli odeme kurulusunun araciligiyla mi tahsil ediyor?
- 6493 sayili Kanun ve ilgili ikincil duzenlemeler bakimindan Hanuja'nin rol tanimi nihai hukuk gorusu ile teyit edilmelidir.
- Repo karari, tahsilatin Iyzico altyapisi ve kontrolu altinda yurutulmesi; Hanuja'nin lisanssiz bir odeme kurumu gibi davranmamasidir.

## Operasyonel ilke

- Kart odemeleri Iyzico uzerinden alinir.
- Webhook dogrulamasi, 3DS donusleri ve refund istekleri backend tarafinda yonetilir.
- Musteri redirect sonucu tek basina basarili odeme sayilmaz; source of truth backend teyididir.
- EFT/havale akisinda bile admin onayi, audit log ve risk kontrolu zorunludur.

## Merkezi tahsilat modeline dair notlar

- Hanuja, saticiya anlik gecis yapan bir "passthrough" sistem gibi degil, kontrollu bir tahsilat ve sonradan payout modeliyle calisir.
- Payout'in `delivery_confirmed` sonrasinda 30 gun hold ile baslamasi, risk ve iade yonetimi nedeniyle is kurali olarak kurgulanmistir.
- Bu bekletme mekaniginin odeme mevzuati ve para saklama yorumu acisindan hukuk tarafinda acikca degerlendirilmesi gerekir.

## Iyzico iliskisinin hukuki sonucu

- Lisansli odeme altyapisi kullanimi, Hanuja'nin dogrudan kart verisi saklamama ve odeme akisini saglayici uzerinden gecirme prensibini destekler.
- Public legal metinlerde "odemeler Iyzico altyapisi ile islenir" ifadesi dogru ama abartisiz kullanilmalidir.
- Hanuja'nin lisans statusu varmis gibi bir dil kullanilmaz.

## EFT/havale ozel dikkatleri

- Havale/EFT odemesi manuel teyit gerektirdigi icin yanlis esleme ve AML riski kart odemesine gore daha yuksektir.
- Gonderen bilgisi, dekont ve siparis iliskisi teyit edilmeden siparis aktiflestirilmemelidir.
- EFT onay veya red kararlari admin aktoru, zaman damgasi ve gerekce ile audit log'a yazilmalidir.

## AML ve risk notlari

- Tekrarlayan basarisiz odeme, ayni cihazdan coklu hesap, supheli banka detay degisimi ve anormal siparis hizi fraud review sinyalidir.
- Yuksek riskli durumlarda siparis, payout veya seller hesabinin bloklanabilmesi gerekir.
- Bu davranislar legal metinlere ayrintili ceza diliyle degil, risk ve dogrulama hakki cercevesiyle yansitilmalidir.

## Hukuk ekibinin incelemesi gereken sorular

- Merkezi tahsilat modelinin hangi kosullarda odeme hizmeti lisansi gerektirip gerektirmedigi
- 30 gun payout hold'un hukuki gerekcesi ve aciklama bicimi
- EFT kabul surecinin mevzuat ve uyum etkileri
- Iade, ceza, mahsup ve negatif bakiye kurgusunun sozlesmesel anlatimi

## Teknik uygulama sinirlari

- Kart verisi uygulama veritabanina persist edilmez.
- Odeme durumunu degistiren kritik islemler yalnizca backend tarafinda yapilir.
- Sandbox ve production ayarlari ayri tutulur; production sirrlari lokalde kullanilmaz.
- Finansal sonuc doguran admin aksiyonlari sessiz mutasyon olarak calismaz; her biri audit kaydi uretir.

## Uygulama etkileri

- Legal ve marketing metinleri Hanuja'yi "odeme kurumu" gibi konumlandirmamalidir.
- Checkout, footer ve guvenli odeme ibareleri Iyzico entegrasyon gercegiyle uyumlu olmali, lisans iddiasi icermemelidir.
- `docs/05-security/payment-security.md` ile webhook, idempotency ve EFT approval anlatimi ayni cercevede kalmalidir.
