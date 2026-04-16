# Hanuja Claude Workflow

Bu dosya, Hanuja projesinde Claude ile çalışırken izlenecek standart üretim akışını tanımlar.

Bu dosyanın amacı:
- hangi dosya ne işe yarar netleştirmek
- Claude oturumlarında tutarlı çalışma sırası oluşturmak
- kural, ayar, skill, agent ve hook katmanlarını birbirine karıştırmamak
- ekip içinde aynı çalışma dilini korumak

---

## 1. Kaynak hiyerarşisi

Hanuja içinde Claude davranışı tek dosyadan değil, katmanlı yapıdan gelir.

Öncelik sırası pratikte şöyledir:

1. `CLAUDE.md`
2. `.claude/rules/`
3. `.claude/settings.json`
4. `.claude/agents/`
5. `.claude/skills/`
6. `.claude/hooks/`
7. `.claude/docs/`
8. proje kodu ve `docs/` klasörü

Açıklama:
- `CLAUDE.md` proje seviyesinde sürekli davranış çerçevesini verir.
- `.claude/rules/` konu bazlı ve daha ayrıntılı kalıcı kuralları içerir.
- `.claude/settings.json` izin, hook ve proje paylaşımına açık Claude ayarlarını tutar.
- `.claude/agents/` özel uzman alt ajanları tanımlar.
- `.claude/skills/` tekrar kullanılabilir görev akışları ve referans becerileri içerir.
- `.claude/hooks/` deterministik güvenlik ve kalite kontrolleri uygular.
- `.claude/docs/` ekip için çalışma rehberi ve kullanım şablonları sağlar.
- `docs/` iş, ürün, mimari, operasyon ve hukuk bilgisinin insan odaklı kaynak alanıdır.

---

## 2. Hangi dosya ne için kullanılır

### `CLAUDE.md`
Şunlar burada olmalı:
- proje amacı
- temel iş kuralları
- ana mimari kararlar
- çalışma biçimi
- cevaplama tarzı
- kalıcı operasyon ilkeleri

Şunlar burada olmamalı:
- aşırı detaylı alan kuralları
- uzun check-list yığınları
- panel bazlı tüm edge-case açıklamaları

### `.claude/rules/`
Şunlar burada olmalı:
- finance
- order lifecycle
- seller panel
- admin panel
- SEO
- security
- testing/release
- architecture
- coding standards

Kural dosyaları source of truth niteliğindedir.

### `.claude/settings.json`
Şunlar burada olmalı:
- project-shared permissions
- hooks
- proje için paylaşılan plugin ayarları
- güvenlik odaklı Claude davranış kısıtları

Şunlar burada olmamalı:
- kişisel API anahtarları
- makineye özel kişisel ayarlar
- kişisel deneysel override’lar

### `.claude/settings.local.example.json`
Bu dosya örnektir.
Gerçek kişisel dosya `.claude/settings.local.json` olur ve commit edilmez.

### `.claude/agents/`
Belirli uzmanlıkları ayrıştırır.
Örnek:
- marketplace-architect
- backend-builder
- seo-strategist
- security-reviewer

### `.claude/skills/`
İki tip skill vardır:
- workflow skill
- reference skill

Workflow skill:
- belirli işi baştan sona yaptırır
- çoğu zaman manuel çağrılır

Reference skill:
- belirli alan bilgisini ilgili dosyalarda otomatik devreye sokar

### `.claude/hooks/`
Hook’lar deterministik güvenlik ve kalite katmanıdır.
Örnek:
- secret taraması
- route politikası kontrolü
- finance kural kontrolü
- otomatik formatlama

### `.claude/docs/`
Bu klasör:
- proje içi Claude kullanım rehberi
- prompt şablonları
- review checklist’leri
içindir.

Bu klasör source of truth policy alanı değildir.
Policy’nin asıl yeri:
- `CLAUDE.md`
- `.claude/rules/`

---

## 3. Hanuja’da standart çalışma sırası

Bir görev geldiğinde varsayılan üretim sırası budur:

### A. Önce görev tipi belirlenir
Görev hangi sınıfa giriyor?

- mimari karar
- backend implementasyonu
- frontend implementasyonu
- SEO
- security review
- QA/release review
- dokümantasyon

### B. Sonra ilgili kural dosyaları okunur
Örnek:
- finance ise `07-marketplace-finance-rules.md`
- order akışı ise `08-order-lifecycle-rules.md`
- seller ekranı ise `09-seller-panel-rules.md`
- admin ekranı ise `10-admin-panel-rules.md`
- release ise `11-testing-release-rules.md`

### C. Gerekirse doğru agent kullanılır
Örnek:
- sistem tasarımı → `marketplace-architect`
- backend iş kuralı uygulaması → `backend-builder`
- arayüz davranışı → `frontend-builder` veya `ui-ux-designer`
- güvenlik inceleme → `security-reviewer`
- SEO kararı → `seo-strategist`
- test ve çıkış onayı → `qa-tester`

### D. Gerekirse doğru skill devreye girer
Örnek:
- `release-checklist`
- `seo-management`
- `order-status-flow`
- `payout-lifecycle`
- `seller-panel-flow`

### E. Sonra kod veya doküman değişikliği yapılır

### F. Son olarak kalite kapıları çalışır
- hook kontrolleri
- rule uyumu
- test ihtiyacı
- release etkisi
- docs etkisi

---

## 4. Değişiklik yaparken zorunlu kararlar

Claude veya geliştirici bir değişikliğe başlamadan önce şu 5 soruyu cevaplamalı:

1. Bu değişiklik hangi yüzeyi etkiliyor?
   - storefront
   - seller panel
   - admin panel
   - backend/domain
   - SEO
   - docs

2. Hangi iş kuralını etkiliyor?

3. Hangi rule dosyaları source of truth?

4. Bu değişiklik role-based görünürlüğü etkiliyor mu?

5. Bu değişiklik finance, payout, delivery confirmation veya penalty mantığını etkiliyor mu?

Eğer son iki sorudan biri “evet” ise:
- kural dosyası kontrolü zorunludur
- test ihtiyacı yüksektir
- hızlı shortcut yaklaşımı kabul edilmez

---

## 5. Hanuja için kırmızı çizgiler

Aşağıdaki konular hiçbir oturumda gevşetilmez:

- merkezi tahsilat modeli
- satıcının sadece ödeme onaylı siparişi görmesi
- payout sayacının `delivery_confirmed` ile başlaması
- 30 gün hold
- standart cezanın ürün tutarının %20’si olması
- `delivered` ve `delivery_confirmed` ayrımının korunması
- SEO route ailelerinin sabit kalması:
  - `/kategori/...`
  - `/urun/...`
  - `/blog/...`
  - `/magaza/...`

---

## 6. Kod üretmeden önce plan zorunlu olan işler

Aşağıdaki işler önce planlanmalı, sonra uygulanmalı:

- ödeme akışı
- webhook akışı
- payout akışı
- ceza ve hakediş mantığı
- order state machine değişikliği
- yeni public route family önerileri
- auth / RBAC değişiklikleri
- panel sınırlarını etkileyen veri görünürlük değişiklikleri
- Meilisearch index yapısı
- R2 dosya erişim politikası
- queue/job tekrar çalıştırma mantığı

Bu tip işlerde önce:
- etkilenen modüller
- invariant’lar
- riskler
- test etkileri
tanımlanır.

---

## 7. Claude’dan beklenen çıktı biçimi

Hanuja içinde Claude cevapları mümkün olduğunca şu sırayı izlemeli:

1. Karar veya öneri
2. Etkilenen dosya/klasörler
3. Kırılmaması gereken kurallar
4. Uygulama sırası
5. Riskler
6. Test / doğrulama ihtiyacı
7. Gerekirse docs güncelleme ihtiyacı

Sadece “şunu yap” tipi muğlak yönlendirme kabul edilmez.

---

## 8. Docs güncelleme zorunluluğu

Aşağıdaki değişiklikler docs etkisi doğurur:

- yeni lifecycle statüsü
- payout mantığı değişikliği
- ceza mantığı değişikliği
- seller/admin görünürlük sınırı değişikliği
- yeni SEO kararları
- yeni route standardı
- yeni güvenlik ilkesi
- yeni release kapısı
- yeni panel akışı

Bu tip değişikliklerde en az biri gözden geçirilmelidir:
- `CLAUDE.md`
- ilgili `.claude/rules/` dosyası
- `.claude/docs/`
- `docs/` altındaki ilgili iş/ürün/operasyon dokümanları

---

## 9. Hızlı karar matrisi

### Yeni özellik ama iş kuralı etkiliyor
Önce:
- `marketplace-architect`
- ilgili rules
Sonra:
- `backend-builder`
- `frontend-builder`

### Sadece UX akışı
Önce:
- `ui-ux-designer`
Sonra:
- `frontend-builder`

### Güvenlik şüphesi
Önce:
- `security-reviewer`
Sonra:
- gerekiyorsa builder agent

### Release öncesi kontrol
Doğrudan:
- `release-checklist`
- `qa-tester`

### SEO kararı
Önce:
- `seo-management`
veya
- `seo-strategist`

---

## 10. Son ilke

Hanuja’da Claude çalışma düzeni şu prensibe dayanır:

- kural önce gelir
- mimari ikinci gelir
- uygulama üçüncü gelir
- hız, doğruluğun yerine geçmez

Bu proje marketplace olduğu için özellikle:
- finance truth
- role boundaries
- order lifecycle
- SEO route discipline
alanlarında kısa yol kabul edilmez.