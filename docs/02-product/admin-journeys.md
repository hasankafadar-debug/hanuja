# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Admin Journeys

Bu belge, Hanuja admin panelindeki ana operasyon yolculuklarini tek bir referansta toplar.
Amac, hangi admin akisinda hangi veri, yetki ve audit beklentisinin oldugunu sabitlemektir.

## Temel ilke

- Admin paneli raporlama degil, yuksek etkili operasyon aracidir.
- Her kritik aksiyon yetki, gerekce ve audit kaydi gerektirir.
- Finansal sonuc doguran islem sessizce uygulanmaz.

## Rol varsayimi

- `admin` teknik roludur.
- Operasyonel alt roller: super admin, finance admin, operations admin, support admin, moderation admin.
- Alt roller permission matrix ile ayristirilir; UI sadece gorunurluk saglar, asil yetki backend'dedir.

## Journey 1: EFT onay kuyrugu

- Giris noktasi: `/admin-panel/odemeler`
- Amac: bekleyen banka transferlerini incelemek ve onaylamak veya reddetmek
- Gerekli veri: siparis, gonderen bilgisi, dekont veya evidence, tahsilat tutari, musteri ve satici baglami
- Karar: approve veya reject
- Zorunlu kontrol: actor kimligi, gerekce, audit log, tekrarli onay korumasi

## Journey 2: Geciken siparis triage

- Giris noktasi: `/admin-panel/siparisler` ve siparis detay sayfasi
- Amac: 20 gun fulfilment riskine giren siparisleri erken fark etmek
- Gerekli veri: siparis status tarihi, satici aksiyonlari, tracking bilgisi, musteri mesajlari
- Karar: saticiyla temas, uzatma, iptal veya penalty degerlendirmesi
- Not: `delivered` ve `delivery_confirmed` ayrimi her ekranda korunur

## Journey 3: Payout readiness review

- Giris noktasi: `/admin-panel/hakedisler` veya `/admin-panel/finans`
- Amac: payout-ready kayitlari bloklayan durum kalmadan batch'e almak
- Gerekli veri: holdUntil, blockedReason, negatif bakiye, return, dispute ve fraud durumu
- **Önemli kural:** `holdUntil` geçmesi yeterli değil, minimum koşuldur. Payout eligible olabilmesi için ayrıca: açık iade yok, açık dispute yok, fraud flag yok, banka detayı doğrulanmış, negatif bakiye offseti uygulanmış olmalıdır.
- Karar: batch schedule, manual release, hold devam
- Zorunlu kontrol: finance admin yetkisi ve audit kaydi

## Journey 4: Penalty apply veya waive

- Giris noktasi: `/admin-panel/cezalar`
- Amac: seller rejection veya 20 gun ihlali sonrasinda ceza kaydini izlemek
- Gerekli veri: tetikleyici olay, urun tutari, penalty hesabi, onceki seller ledger durumu
- Karar: uygulama, waive, not ekleme
- Kural: waiver durumunda bile tarihce korunur

## Journey 5: Return ve dispute resolution

- Giris noktasi: `/admin-panel/iadeler` ve `/admin-panel/uyusmazliklar`
- Amac: musteri ve saticidan gelen delilleri inceleyip karar vermek
- Gerekli veri: iade nedeni, fotograf, mesaj, teslimat kaydi, payout baglami
- Karar: tam refund, kismi refund, red, ek delil isteme
- Kural: dispute acikken payout bloklu kalir

## Journey 6: Seller denetim ve askiya alma

- Giris noktasi: `/admin-panel/saticilar` ve satici detay sayfasi
- Amac: riskli veya tekrar eden politika ihlali olan saticiyi denetlemek
- Gerekli veri: fulfilment performansi, ceza gecmisi, risk sinyalleri, katalog sorunlari
- Karar: warning, gecici kisit, payout freeze, suspension
- Kural: yuksek etkili kararlar support notu degil, audit edilen admin eylemidir

## Journey 7: Moderation kuyrugu

- Giris noktasi: `/admin-panel/urunler`
- Amac: seller icerigini kalite, uygunluk ve risk acisindan incelemek
- Gerekli veri: baslik, aciklama, gorsel, kategori, fiyat, stok, policy uyumu
- Karar: approve, needs revision, reject, hide
- Kural: seller'a geri bildirim net, eylem odakli ve tekrar incelenebilir olmalidir

## UI beklentileri

- Liste ekranlarinda filtre, kuyruk ve durum etiketi zorunludur.
- Kritik aksiyonlar modal veya ikincil onay ister.
- Maskelenmesi gereken veri alanlari tam acik gosterilmez.
- Her detay ekraninda ilgili audit ve event gecmisi okunabilir olmalidir.

## Dokuman baglantilari

- Order karar mantigi: `docs/07-operations/order-lifecycle.md`
- Finansal akis: `docs/07-operations/payout-lifecycle.md`
- Admin yetki mantigi: `docs/05-security/admin-action-policy.md`
