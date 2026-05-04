# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Seller Agreement Outline

Bu belge, Hanuja ile saticilar arasindaki sozlesmenin omurgasini tanimlar.
Odak, platform kurallari ile kod tarafinda zaten kabul edilmis ticari ve operasyonel gercekleri uyumlu anlatmaktir.

## Sozlesmenin amaci

- Saticinin pazaryeri katilim kosullarini belirlemek
- Katalog, fulfilment, payout ve ceza kurallarini yazili hale getirmek
- Yetki, denetim ve fesih mekaniklerini acik tanimlamak

## 1. Satici uygunlugu ve onboarding

- Satici, gerekli ticari belge ve kimlik dogrulamalarini tamamlamis olmalidir.
- Banka/IBAN bilgisi payout oncesi dogrulanabilir bir kayit olarak tutulur.
- Supheli banka bilgisi degisiklikleri gecikmeli aktivasyon ve ek incelemeye tabi olabilir.

## 2. Katalog yukumlulukleri

- Urun basligi, aciklama, gorsel, stok ve fiyat bilgisi gercege uygun olmalidir.
- Yasakli urun, taklit, aldatıcı iddia, sahte indirim veya mevzuata aykiri ilan yayinlanamaz.
- Hanuja, moderasyon hakki cercevesinde urunu `draft`, `pending_review`, `published`, `unlisted`, `rejected` durumlariyla yonetebilir. Bu degerler sistemdeki `ProductStatus` enum degerleridir.

## 3. Siparis fulfilment yukumlulukleri

- Satici yalnizca odemesi onayli siparislere erisir.
- Siparisin standart fulfilment suresi 20 gundur.
- Takip numarasi girilmeden kargoya verildi beyaninda bulunulamaz.
- `delivered` ile `delivery_confirmed` ayrimi payout hesabinda kritik oldugundan sozlesmede de acikca korunmalidir.

## 4. Komisyon ve ucretler

- Komisyon, urun bazli override, kategori orani, satici genel orani ve sistem varsayimi zincirine gore hesaplanir.
- Reklam, servis, cargo ve diger kesintiler komisyondan ayridir.
- Hanuja servis faturasi kesebilir; urun satis faturasi satici sorumlulugundadir.

## 5. Payout kosullari

- Payout geri sayimi yalnizca `delivery_confirmed` sonrasinda baslar.
- Standart hold suresi 30 gundur.
- Iade, uyusmazlik, fraud review, eksik banka bilgisi veya negatif bakiye gibi durumlar payout'i bloklayabilir.
- Mahsup, ceza ve negatif bakiye sonraki odemelerden dusulebilir.

## 6. Ceza rejimi

- Standart ceza urun tutarinin yuzde 20'sidir.
- Tipik tetikleyiciler: odemesi alinmis siparisin satici tarafindan reddi ve 20 gunluk fulfilment taahhudunun ihlali.
- Waiver ancak yetkili admin karari, gerekce ve audit log ile mumkundur.

## 7. Iade ve uyusmazliga katilim

- Satici, iade ve uyusmazlik sureclerinde istenen bilgi ve delilleri makul surede sunmakla yukumludur.
- Iade karari payout oncesi ya da sonrasi farkli finansal sonuc dogurabilir.
- Kismi refund ve delil incelemesi gerektiren senaryolar sozlesmede tanimlanmalidir.

## 8. Platform denetim ve moderasyon hakki

- Hanuja, sahte icerik, tekrar eden ihlal, yuksek risk sinyali veya operasyonel uyumsuzluk halinde satici faaliyetini kisitlayabilir.
- Urun gizleme, yayin durdurma, payout freeze, ek belge talebi ve gecici askiya alma gibi kontroller sozlesmede acik yazilmalidir.

## 9. Fesih ve bakiye kapanisi

- Hesap kapansa bile acik iade, uyusmazlik, penalty veya negatif bakiye kapanmadan ticari iliski tamamen sona ermez.
- Gecmis ledger ve audit kayitlari hukuki ve muhasebesel sebeplerle saklanabilir.

## 10. Uygulanacak hukuk

- Taslak varsayim, Turk hukuku ve Istanbul yetkili mahkemeleri/cra daireleridir.
- Sirket unvani, adres, vergi ve iletisim bilgileri final metinde tamamlanmalidir.

## Uygulama etkileri

- Seller panelindeki uyarilar, penalty gorunumleri ve payout aciklamalari bu sozlesmeyle ayni terminolojiyi kullanmalidir.
- `docs/01-business`, `docs/05-security/seller-iban-verification.md` ve `docs/07-operations` belgeleriyle celisen bir ticari hak tanimi kullanilmamalidir.
- Yayina alinacak seller agreement, sadece genel niyet beyani degil; mevcut platform kurallarini acikca referanslayan uygulanabilir bir sozlesme olmalidir.
