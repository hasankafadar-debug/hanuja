# Son güncelleme: 2026-04-18
# Durum: taslak v1 - Hukuki inceleme gereklidir. Bu belge taslak niteliğindedir.

# KVKK Notes

Bu belge, Hanuja'nin KVKK uyumlu aydinlatma metni ve ic surecleri icin calisma notudur.
Nihai aydinlatma metni degil; veri sorumlusu detaylari ve saklama sureleri hukuk ve operasyon tarafinda son kez teyit edilmelidir.

## Veri sorumlusu cercevesi

- Hanuja, musteri, satici ve admin kullanicilarindan toplanan kisisel veriler icin veri sorumlusu gibi davranir.
- Nihai kamuya acik metinde sirket unvani, adres, iletisim bilgisi ve basvuru kanali acik yazilmalidir.
- Odeme, kargo ve altyapi saglayicilari ise isleyen veya ayri veri sorumlusu niteligi tasiyabilir; bu ayrim sozlesmesel olarak netlestirilmelidir.

## Toplanan veri kategorileri

| Kategori | Ornek alanlar | Kaynak |
|----------|---------------|--------|
| Kimlik ve hesap | ad, soyad, e-posta, telefon | kayit, hesap, checkout |
| Teslimat ve iletisim | adres, il, ilce, alici notlari | siparis ve adres kaydi |
| Odeme baglam verisi | masked kart bilgisi, odeme sonuc kodlari, EFT gonderen bilgisi | Iyzico ve banka transfer akisi |
| Ticari islem verisi | siparis, iade, uyusmazlik, payout, ceza, ledger | uygulama ve admin islemleri |
| Teknik guvenlik verisi | IP, oturum, cihaz ve log kayitlari | auth, middleware, audit |
| Gorsel/delil verisi | iade fotograflari, uyusmazlik dosyalari | return/dispute akisi |

## Isleme amaclari

- Siparis alma, odeme alma, teslimat ve iade sureclerini yurutmek
- Satici onboarding, payout ve finansal mahsuplari yonetmek
- Dolandiricilik, chargeback, risk ve guvenlik sinyallerini incelemek
- Yasal yukumlulukleri yerine getirmek ve denetim kaydi tutmak
- Acik riza varsa kampanya ve pazarlama iletisimleri yapmak

## Veri paylasilan taraflar

- Iyzico: kart odemesi, 3DS, refund ve odeme sonuclari
- Kargo saglayicilari: teslimat ve takip sureci
- Bulut altyapisi ve object storage saglayicilari: medya, delil ve uygulama barindirma
- Muhasebe veya denetim ekipleri: zorunlu finansal raporlama kapsaminda
- Hukuken yetkili kurumlar: resmi talep veya yasal zorunluluk halinde

## Yurtdisi aktarim dikkati

- Cloudflare R2 veya benzeri bulut servisleri yurtdisi veri aktarimi riski dogurabilir.
- Final KVKK metni, hangi servislerin Turkiye disinda veri isleyebilecegini aciklamali ve gerekli hukuki dayanakla desteklenmelidir.
- Teknik ekip, veri sinifina gore hangi varligin yurtdisina cikabilecegini envanter bazinda belirlemelidir.

## Saklama ve imha notlari

- Siparis, payout, audit ve finansal kayitlar ticari ve yasal zorunluluklar nedeniyle daha uzun saklanabilir.
- Pazarlama iletisim tercihleri ayrica tutulmali ve geri alma islemi kayda alinmalidir.
- Destek kayitlari, iade ve uyusmazlik delilleri is amaci ortadan kalktiginda veya yasal sure doldugunda silinmelidir.
- Saklama sureleri final metinde tablo halinde aciklanmali, "sinirsiz saklama" gibi mulak ifadeler kullanilmamalidir.

## Veri sahibi haklari

- Bilgi talep etme
- Duzeltme isteme
- Silme veya yok etme talebi
- Isleme itiraz etme
- Aktarim veya sinirlama talepleri
- Zararin giderilmesini talep etme

## Basvuru sureci notu

- Kamuya acik aydinlatma metninde belirli bir basvuru kanali tanimlanmalidir.
- E-posta, destek formu veya kayitli posta secenegi operasyonel olarak belirlenmeden yayin yapilmamalidir.
- Basvuruya cevap sureleri ve kimlik dogrulama adimlari ic prosedurde ayrica yazilmalidir.

## Guvenlik ve erisim kontrolu etkileri

- Seller verisi seller ownership check ile ayrilmali, admin gorunumleri maskeleme kurallarina uymalidir.
- Banka detaylari, masked gosterim ve degisim audit log'u ile korunmalidir.
- CSRF, session dogrulamasi, rate limiting ve audit logging KVKK acisindan da onemli destek kontrolleridir.

## Urun ve hukuk ekibi icin acik maddeler

- Veri sorumlusu kesin unvani ve iletisim bilgileri
- Pazarlama acik riza mekanigi ve tercih saklama modeli
- Yurtdisi aktarim hukuki dayanaklari
- Her veri kategorisi icin net saklama suresi

## Uygulama etkileri

- `/kvkk` sayfasi, public legal rotalarla tutarli bir baslik ve son guncelleme bilgisini gostermelidir.
- Checkout, kayit ve hesap alanlarinda kullanilan metinler bu belgeyle uyumlu veri kategorilerini referanslamalidir.
- Log, audit ve delil depolama kararlarinda `docs/05-security` ile celisen ifade kullanilmamalidir.
