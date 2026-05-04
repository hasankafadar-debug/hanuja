# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Return Cancellation Outline

Bu belge, public `iade-iptal` sayfasi icin kullanilacak icerik omurgasini tanimlar.
Amac, musteriye hangi durumda iptal, hangi durumda iade ve hangi durumda uyusmazlik akisinin devreye girdigini acik gostermektir.

## Sayfanin amaci

- Kargoya verilmeden once iptal kurallarini aciklamak
- 14 gunluk cayma hakki akisini ayri bir baslikta vermek
- Kargo sonrasi iade ile uyusmazlik akisini birbirine karistirmamak
- Refund zamanlamasi ve sorumluluklarini netlestirmek

## 1. Kargo oncesi iptal

- Siparis henuz kargoya verilmediyse musteri iptal talep edebilir.
- Odeme basarili alinmissa, iptal onayi sonrasi refund baslatilir.
- Satici reddi veya admin iptali gibi durumlar musteri tarafinda tek bir "iptal" gibi gorunse de sistemde farkli statuslerle izlenir.

## 2. Kargo sonrasi iade

- Siparis `shipped` durumuna gectikten sonra basit iptal degil, iade proseduru isler.
- Musteri 14 gun icinde cayma hakki kapsaminda iade talebi olusturabilir.
- Iade sureci iade talebi, delil/gorsel, onay ve refund asamalarindan olusur.

## 3. 14 gunluk cayma hakki

- Genel kural, teslimden itibaren 14 gun icinde sebep gostermeksizin cayma hakkinin kullanilabilmesidir.
- Uygulamada hizli yol iade akisi bu sure icin optimize edilir.
- Hukuki istisnalar varsa kategorik olarak sayfada ayrica listelenmelidir.

## 4. 14 gun sonrasi talepler

- 14 gun sonrasinda iade otomatik hak olarak ele alinmaz.
- Talep, urunun durumu, kusur iddiasi, teslimat kaydi ve seller savunmasi ile admin degerlendirmesine girer.
- Bu akista musteriye "inceleme gerekiyor" dili kullanilmali, otomatik hak vaadi verilmemelidir.

## 5. Kusurlu veya yanlis urun senaryolari

- Ayipli, hasarli veya yanlis urun senaryolari normal cayma akisindan ayrik incelenebilir.
- Delil fotografi, mesajlasma kaydi ve teslimat gecmisi karar icin toplanabilir.
- Gerekli durumda satici sorumlulugu veya platform kaynakli operasyon hatasi ayrica not edilmelidir.

## 6. Refund zamanlamasi

- Iade, seller payout oncesi onaylanirsa payout dusurulur veya bloklanir.
- Iade, seller payout sonrasi onaylanirsa tutar seller ledger borcu olarak izlenebilir.
- Kismi iade kararlari desteklenebilir; bu nedenle metin yalnizca "tam iade" varsayimi yapmamalidir.

## 7. Basvuru kanallari

- Musteri, hesap alanindan veya destek kanali uzerinden talep baslatabilmelidir.
- Legal sayfa, kullaniciyi net bir rota veya destek adresine yonlendirmelidir.
- Talebin alinmasi, incelenmesi ve sonuc bildirimine dair mesajlar operasyonel SLA ile uyumlu olmali, tek bir sabit gun sayisina baglanmamalidir.

## 8. Status esleme notlari

| Kullaniciya gorunen kavram | Sistem baglami |
|---------------------------|----------------|
| Siparis iptali | payment failure, customer pre-shipment cancel, seller rejection, admin cancel |
| Iade talebi | return request akisi |
| Uyusmazlik | dispute akisi, iadeden ayridir |
| Odeme iadesi | refund / partial refund sonucu |

## 9. Public metin icin eksik ama zorunlu alanlar

- Return shipping cost sorumlulugu
- Iade adresi veya yonlendirme sureci
- Mevzuata dayali istisna urun listesi
- Musteri bildirim kanali ve isleme suresi

## Uygulama etkileri

- Checkout, siparis detay ve hesap ekranlari ayni terminolojiyi kullanmalidir.
- `docs/07-operations/order-lifecycle.md` ile `docs/01-business/refund-return-policy.md` arasindaki ayrimlar public policy diline bozulmadan yansimalidir.
- Public sayfa, hak tanimi ile operasyonel review gerektiren alanlari ayni baslikta birlestirmemelidir.
