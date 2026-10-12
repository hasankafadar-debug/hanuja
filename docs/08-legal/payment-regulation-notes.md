# Son güncelleme: 2026-10-11 (satici Hanuja modeli)
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Payment Regulation Notes

Bu belge, Hanuja'nin merkezi tahsilat modelinin odeme mevzuati acisindan tasidigi riskleri ozetler.
Amac, urunu lisansli odeme kurumu gibi konumlandirmadan Iyzico etrafinda dogru teknik ve hukuki sinirlari belirlemektir.

## Satici Hanuja modeli (2026-10)

- Odeme kuruluslari duz sanal POS icin uye isyerinin satilan malin saticisi olmasini istiyor; iyzico'nun
  pazaryeri urunu mobilya satisini kabul etmiyor. Bu nedenle sozlesmelerde **satici Hanuja**dir; tasarimci
  ve markalar Hanuja'nin tedarikcisidir. Musteri odemesi Hanuja'nin kendi satisinin bedelidir; ucuncu
  kisi adina tahsilat ve sonradan aktarim kurgusu bu modelde yoktur.
- Fatura akisi: Hanuja musteriye satis faturasi keser (kargoya verilisten itibaren 7 gun, VUK 231/5);
  tedarikci (satici) siparisi Hanuja'ya faturalar (tutar: KDV dahil satis − satici kupon payi − KDV dahil
  komisyon). Hakedis, onayli tedarikci faturasinin tarihinden 30 gun sonraki ilk cuma odenir.
- Urunu tedarikci dogrudan musteriye gonderir (dropship). Irsaliyede "<Hanuja unvani> adina musteriye
  teslim edilmek uzere" ibaresi kullanilir. Benzer yapi icin Gelir Idaresi ozelgesi: Istanbul VDB
  08.03.2012, B.07.1.GIB.4.34.19.02-019.01-918 (mali musavirle teyit edilmelidir).
- Kart odemesi `IYZICO_CARD_PAYMENTS_ENABLED` ile acilir; iyzico onayi ve yeni sozlesme metinleri
  yayina girmeden acilmaz.
- Mali musavire sorulacaklar: irsaliye kopyasinin sisteme alinmasi, musteri iadesinde belge ve Hanuja →
  tedarikci iade faturasi, ceza belgesinin turu.

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
- Hakedis vadesi tedarikci faturasina baglidir: onayli fatura tarihi + 30 gun sonrasindaki ilk cuma; ayrica teslim onayi ve acik iade/uyusmazlik olmamasi gerekir. Bu, ticari bir odeme vadesi olarak kurgulanmistir.
- Vadenin ve mahsup/negatif bakiye kurgusunun tedarikci sozlesmesinde acikca yazilmasi gerekir; hukuk tarafinda degerlendirilmelidir.

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
- Tedarikci faturasina bagli 30 gunluk odeme vadesinin sozlesmesel anlatimi
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
