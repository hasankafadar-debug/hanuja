# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# Distance Sales Notes

Bu belge, Mesafeli Sozlesmeler Yonetmeligi kapsaminda Hanuja'da yayinlanacak on bilgilendirme ve mesafeli satis metinleri icin calisma notudur.
Odak, musteriye siparis oncesi ve siparis sonrasi verilmesi gereken bilgiler ile bunlarin urun akisina baglanmasidir.

## Temel hukuki cerceve

- Siparis oncesinde urun, fiyat, satici, teslimat suresi ve cayma hakki bilgileri gorunur olmalidir.
- Siparis kurulduktan sonra kullanici, yaptigi isleme ait teyit bilgisini saklayabilmelidir.
- 14 gunluk cayma hakki standart akistir; istisnalar ayrica acik yazilmalidir.
- Iade ve refund sureleri, operasyonel statulerle uyumlu olmali; belirsiz ifade kullanilmamalidir.

## Hanuja modeline ozel yorum

- Musteri odemeyi Hanuja uzerinden yapar, ancak urunun satisi ve fiziksel ifasi ilgili satici tarafindan gerceklestirilir.
- Bu nedenle mesafeli satis metninde platform rolu ile urun saticisinin rolu birbirine karistirilmamalidir.
- Servis faturasi ile urun faturasi ayrimi, metinde acik bir not olarak yer almalidir.

## Siparis oncesi zorunlu icerik

- Urun adi, temel ozellikleri ve varsa varyant bilgisi
- Toplam bedel, varsa indirim ve kargo etkisi
- Satici bilgisi
- Tahmini teslim suresi ve 20 gunluk fulfilment taahhudu baglami
- Cayma hakki ve istisnalari
- Iade sureci ve basvuru kanallari
- Odeme yontemi ve guvenli odeme altyapisi bilgisi

## Siparis sonrasi teyit

- Order ozeti ve siparis numarasi
- Musteri bilgileri ve teslimat adresi
- Satin alinan urunler ve birim fiyatlar
- Toplam tahsilat tutari
- Satici bazli fulfilment sorumlulugu
- Iade ve destek kanallarina erisim

## Cayma hakki notlari

- Standart senaryoda musteri 14 gun icinde sebep gostermeksizin cayabilir.
- Kargoya verilmeden once iptal ile kargo sonrasi cayma/iade ayrimi net olmalidir.
- Kisisellestirilmis urun, hijyen veya mevzuat istisnasi iceren kategoriler varsa bunlar yayin oncesi acikca listelenmelidir.
- Uygulama tarafinda "hizli yol" iade akisi bu sure icin optimize edilir.

## Refund zamanlamasi

- Onaylanmis iade talebinde refund sureci iade urununun teslim alinmasi veya cayma talebinin mevzuata uygun tamamlanmasi sonrasinda isler.
- Refund, seller payout oncesi ise odeme bloklanir veya dusulur.
- Refund, seller payout sonrasi ise seller ledger borcu olarak izlenebilir.

## Uygulama akisiyla esleme

| Hukuki kavram | Uygulama karsiligi |
|--------------|--------------------|
| Siparis olusumu | `draft`, `checkout_started`, `payment_pending` |
| Odemesi tamam siparis | `payment_confirmed` veya EFT onayi |
| Teslimat | `delivered` — **Not:** bu durum hakediş sayacını başlatmaz |
| Teslimatin kesinlestigi an | `delivery_confirmed` — hakediş countdown yalnızca buradan başlar |
| Cayma / iade | return request akisi |
| Uyusmazlik | dispute akisi, iadeden ayridir |

## Dinamik sozlesme gereksinimi

- `/mesafeli-satis` sabit bilgi veren bir public sayfa olabilir.
- Siparis ozel onizleme veya metin, order objesinden doldurulmus dinamik alanlar icermelidir.
- Dinamik alanlar yanlis veya eksik dolduruluyorsa odeme butonu aktif hale gelmemelidir.

## Hukuk incelemesi gereken alanlar

- Hanuja'nin araci mi, satisa taraf mi, hangi olculerde sayilacagi
- Cayma hakki istisnalari icin kategori listesi
- Return shipping cost'un hangi senaryoda kimde oldugu
- Siparis sonrasi teyit metninin zorunlu alanlari

## Uygulama etkileri

- Checkout'taki sozlesme checkbox'lari bu belgeye dayali ayri metinlere baglanmalidir.
- `docs/07-operations/order-lifecycle.md` ve `docs/01-business/refund-return-policy.md` ile status dili tutarli kalmalidir.
- Mesafeli satis onizlemesi order bazli veriyle doldurulacaksa bos alan toleransi olmamalidir.
