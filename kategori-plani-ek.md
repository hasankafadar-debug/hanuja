# Kategori Genişletme — Codex Planına Düzeltmeler, Kararlar ve Kategori Ağacı

- **Sürüm:** 3 (Codex'in ikinci incelemesi sonrası) · 13.10.2026
- **Uygulandığı plan:** Codex'in "Kategori ağacı, dinamik şablonlar ve ürünlere göre filtreler" planı. İki belge çelişirse bu belge geçerlidir.
- **Kaynaklar:** Codex planı ve iki incelemesi, depo kodu, Hasan ile soru-cevap kararları, `Katagori Ağacı.xlsx` (depo kökünde), Hepsiburada kategori menüsü (Kozmetik ve Elektronik için).
- **Durum:** Plan eki. Kod, veritabanı veya canlı sistemde değişiklik yapılmadı.

---

## 0. Sürüm geçmişi

### 0.1 Sürüm 3'te değişenler (Codex'in sürüm 2 incelemesi)

| # | Codex bulgusu | Çözüm | Bölüm |
|---|---|---|---|
| 1 | Yalnız stoklu varyantları indekslemek, stoksuz ürünü aramadan kaldırır | Arama ürün başına **tek belge** kullanır; belge stoktan bağımsız olarak indekste kalır ve filtresiz aramada bulunur. Varyant alanının yalnız stoğu olan varyantlardaki değerleri, filtre için ayrı bir dizide tutulur. Stok şartı yalnız varyant filtresi ya da "Stokta" seçildiğinde uygulanır. Ek bulgu: Bugün varyantlı üründe sipariş ve iptal, ürün stoğunu ve arama indeksini güncellemiyor; düzeltilir. | §3.4 Varyant eşleşmesi |
| 2 | Varyant rengi/materyali kaydedilmiyor | Kontrol edildi ve doğru: Excel kolonları ayrıştırılıyor, tekli ürün API'si varyantta `color`/`material` kabul ediyor, ama iki yol da bu değerleri kaydetmiyor. Renk ve materyal **ürün düzeyinde** kalır; her renk aynı Model Kodu ile ayrı ürün olarak yüklenir (mevcut tasarım). "Varyant Rengi" ve "Varyant Materyali" kolonları ve API alanları kaldırılır; dolu gelirse hata verir. Renk/beden testi Model Kodu kardeşleriyle, form ve Excel yollarının ikisinde yapılır. | §3.4 Varyant alanı, §3.5 |
| 3 | ml, g ve adet birbirine çevrilemez; Hacim'in kanonik birimi tutarsız | Her ölçüm türü ayrı anahtar: `hacim_ml`, `net_agirlik_g`, `paket_adedi`… "Net İçerik", bunlardan en az birinin dolu olmasını isteyen grup zorunluluğudur. Hacim her yerde ml saklanır; litre yalnız giriş ve gösterim birimidir. | §3.3, §4.4 |
| 4 | Birim değişikliğinde eski değerin anlamı kayboluyor | Ürünlerde kullanılmış bir alanın kanonik birimi ve ölçüm türü değiştirilemez. Yalnız gösterim birimi değişebilir. Farklı ölçüm türü için yeni alan anahtarı açılır. | §3.3 Veri koruma |
| 5 | Ürün hacmi ile varyant hacminin ilişkisi belirsiz | Varyant alanı bir özellik anahtarına karşılık geliyorsa (Beden, Hacim, Net İçerik, Bez Numarası) değer varyant düzeyinde tutulur, ürün düzeyinde ayrıca girilmez. Serbest metin varyantlı şablonlarda (Ölçü, Ton, Uyumlu Model) ürün düzeyindeki alanlar bütün varyantlar için ortaktır. Ürün sayfası, filtre ve sipariş belgesinin hangi değeri kullandığı yazıldı. Bebek bezi için `BEB-BEZ` şablonu (varyant: Bez Numarası). | §3.4 Varyant alanı |
| 6 | Kategori değişikliği zorunlu alan kontrolünü aşabilir | Tasarımcının ve admin'in kategori değişikliği hedef şablonun zorunlu alanlarını doğrular. Eski ürün muafiyeti yalnız kategori değişmeden yapılan düzenlemelerde geçerlidir. | §3.3 Zorunluluk |
| Not | Meilisearch'te `distinct` ile facet sayısı doğrulanmadı | Ürün başına tek belge kullanıldığı için `distinct` gerekmez; facet sayıları doğrudan ürün sayısıdır. Sürüm yine sabitlenir; facet sayısı testi kalır. | §3.4 |

### 0.2 Sürüm 2'de değişenler (Codex'in sürüm 1 incelemesi)

| # | Codex bulgusu | Çözüm |
|---|---|---|
| 1 | Zorunlu alan yanlış ürünlere uygulanıyordu | Araç ve setler ayrı şablonda (`KOZ-ARAC`, `KOZ-SET`, `ELK-AKS`); zorunlu alan kuralı ve Ek B. |
| 2 | Kova değerleri ("64+ GB") | Sayısal alanlar sayı olarak saklanıyor. |
| 3 | Kategori kilidinin eski ürünlere geçişi | `firstPublishedAt`, tetikleyici, kanıtlardan doldurma ve politika. |
| 4 | Eski Excel çelişkisi | Şablon bazında uyumluluk sürümü. |
| 5 | Sözleşme zaten v5 | Yeni tarihli v6. |
| 6 | Varyant eşleşmesi tasarımı | Kural ve kabul testi (sürüm 3'te sadeleştirildi). |
| 7 | Bütün bedenleri göstermek | 14 alt küme. |
| 8 | Şablon değişikliğinde veri koruma | Kurallar (sürüm 3'te birim kuralı güncellendi). |

---

## 1. Özet: Değişen temel karar

Codex planı ağacı Excel'deki gibi **Kadın / Erkek / Anne&Çocuk** köklerine göre kuruyordu. Bu plan bunu değiştiriyor:

- Ağaç **ürün tipine göre** kurulur. Kadın, Erkek ve Anne&Çocuk kök olarak açılmaz. Örnek: kadın, erkek ve çocuk sweatshirt'leri tek bir `Giyim > Üst Giyim > Sweatshirt` dalına yüklenir.
- **Cinsiyet, yaş grubu, kullanım, büyük beden ve tesettür** dal değil, ürün özelliğidir. Tasarımcı her ürün için seçer, müşteri filtreden seçer.
- **Renk ve materyal ürün düzeyindedir.** Bir modelin farklı renkleri, aynı Model Kodu ile ayrı ürünler olarak yüklenir ve ürün sayfasında birlikte gösterilir (mevcut tasarım). Varyantlar beden, hacim, ölçü gibi tek bir boyutu taşır.
- **9 ana kategori** vardır: Ev ve Ofis (mevcut, değişmiyor); Giyim, Ayakkabı, Aksesuar, Anne & Çocuk, Kozmetik & Kişisel Bakım, Elektronik, Spor & Outdoor (yeni).
- **Tasarımcı ağacı ile mağaza ağacı aynıdır.** Ayrı bir mağaza ağacı kurulmaz; farklar yalnız görünürlük ve menüdedir (§5.2).
- **Yeni düğüm sayısı:** 7 ana kategori, 50 alt-1, 280 yaprak; toplam 337 düğüm. **Şablon sayısı:** 50.
- **Excel'in 310 satırı:** 290 satır belirli yapraklara, 10 satır bir dalın tamamına eşlendi; 5 satır filtreye dönüştü ("Tesettür", "Büyük Beden" gibi); 5 gıda satırı çıkarıldı. Satır satır karşılığı Ek A'dadır.

---

## 2. Kararlar

| # | Konu | Karar |
|---|---|---|
| 1 | KDV | **Kapsam dışı.** Kategoriye KDV oranı tanımlanmaz. Otomatik faturalamaya (Uyumsoft API) geçilince eklenir. |
| 2a | Ana kategoriler | Ev, Ofis, Giyim, Ayakkabı, Aksesuar, Anne & Çocuk, Kozmetik & Kişisel Bakım, Elektronik, Spor & Outdoor. Tasarımcı ekranında ve mağaza menüsünde bu sırayla. |
| 2b | Çocuk ürünleri | Çocuk ve bebek giyimi **Giyim**'de, ayakkabısı **Ayakkabı**'da durur; yaş grubu seçilir. Anne & Çocuk'ta yalnız giyim dışı ürünler bulunur (taşıma, beslenme, bakım, bebek odası, oyuncak). |
| 2c | Yaş grubu | Yetişkin / Çocuk / Bebek. |
| 2d | Cinsiyet | Kadın / Erkek / Unisex. Unisex ürün "Kadın" ve "Erkek" filtrelerinin ikisinde de çıkar; ayrıca "Unisex" filtresi vardır. Çocuk ve bebekte "Kadın" seçeneği "Kız" olarak etiketlenir. |
| 2e | Excel dönüşümü | Claude yaptı (§5, Ek A); Hasan onaylar. |
| 2f | Spor & Outdoor | Ana kategori olur ama **yalnız ekipman** içerir. Tayt, eşofman gibi spor giyim Giyim'e, koşu ayakkabısı Ayakkabı'ya yüklenir ve "Kullanım" filtresiyle ayrılır. Spor & Outdoor ürünlerinde de "Kullanım: Spor / Outdoor" filtresi bulunur. |
| 2g | Büyük Beden, Tesettür | Dal değil, filtre (Evet/Hayır). Büyük beden sweatshirt `Sweatshirt` dalına yüklenir, "Büyük Beden: Evet" seçilir. |
| 2h | Kozmetik | Ana kategorinin adı **Kozmetik & Kişisel Bakım**'dır; ped, tıraş, ağız bakımı, cinsel sağlık da buradadır. |
| 2i | Gıda | Bebek maması, kavanoz/kaşık mama, sporcu besinleri **şimdilik ağaçta yok**. İleride admin dal ekleyerek açabilir (mevzuat teyidinden sonra). |
| 3 | Beden | Harf ve sayılar **tek ortak sabit sözlükte** (154 benzersiz değer; buçuklu numaralar ve S/M, 38-40 gibi kombine bedenler dahil). Serbest yazılmaz. Form ve Excel, şablona ve yaş grubuna göre yalnız ilgili alt kümeyi gösterir (§4.2). Admin sözlüğe değer ekleyebilir. |
| 4 | Arama | Meilisearch'te ürün başına tek belge; kategori yolu, özellikler ve stoğu olan varyantların değerleri indekslenir. Stoksuz ürün filtresiz aramada bulunur (§3.4). |
| 5 | Ürün sayfası ve sözleşme | Ürün sayfasında "Ürün Özellikleri" tablosu; Mesafeli Satış ve Ön Bilgilendirme'deki "temel nitelikler" aynı kaynaktan; belge sürümü yeni tarihli **v6** (§3.4). |
| 6 | Cayma hakkı | **Değişiklik yok.** Genel istisna listesi sözleşmelerde ve e-postalarda zaten var; ürün bazında uyarı eklenmez. |
| 7 | Alanların alt dallara geçmesi | **Şablon yöntemi** (§3.3). |
| 7b | Zorunlu alan | Yeni ürün oluştururken ve **kategori değiştirirken** hedef şablonun zorunlu alanları denetlenir. Kategori değişmeden yapılan düzenlemede dolu zorunlu alan boşaltılamaz, zaten boş olan doldurulmaya zorlanmaz. Mevcut ürünler yayında kalır. |
| 8 | Mevcut ürünlere özellik doldurma | Yapılmaz. |
| 9 | Kategori değişikliği | Ürün hiç yayımlanmamışken tasarımcı kategoriyi değiştirebilir. Bir kez yayımlanmış üründe kilitlidir; gerekirse admin değiştirir. Kilit kalıcı `firstPublishedAt` işaretine dayanır (§3.4). |
| 10 | Tasarımcı ekranı | Toplu ve tekli yüklemede ilk seçim 9 ana kategori, sonra sırayla alt dallar. Kategori arama kutusu eklenmez. |
| 11 | Mağaza menüsü | Üst menü = 9 ana kategori + en sonda "İndirim". Mobilya, Aydınlatma, Dekorasyon gibi ev/ofis dalları Ev ve Ofis'in açılır menüsünde durur. |
| 11b | Aksesuar adresi | Yeni Aksesuar kategorisi `/kategori/taki-aksesuar` adresini alır. `/kategori/aksesuar` mevcut ev+ofis aksesuar sayfası olarak kalır. |
| 12 | Etkilenen yerler | Model değişikliği listelenen bütün tüketicileri ve bağlı testleri kapsar (§3.4). |
| 13 | Canlıya çıkış | İki aşama. Her aşama yerelde üç panelde uçtan uca test edilmeden canlıya çıkmaz. "Ürünü olmayan kategori gizli" şartı korunur (§3.5). |
| 14 | Sayısal alanlar | Her ölçüm türü ayrı bir anahtar ve tek kanonik birimle sayı olarak saklanır (§4.4). Kova değerleri ("64+ GB") saklanmaz. Kullanılmış alanın kanonik birimi değiştirilemez. |
| 15 | Şablon değişikliği | Hiçbir ürün değeri şablon değişikliğiyle silinmez; çıkarılan alanlar gizlenir, seçenekler pasifleştirilir (§3.3). |
| 16 | Renk ve materyal | Ürün düzeyindedir. Farklı renkler aynı Model Kodu ile ayrı ürün olarak yüklenir. "Varyant Rengi" ve "Varyant Materyali" kaldırılır. |
| 17 | Varyant değerleri | Bir şablonun tek varyant alanı vardır: Beden, Hacim, Net İçerik, Bez Numarası ya da serbest metin olan Ölçü, Ton, Uyumlu Model. Alan bir özellik anahtarına karşılık geliyorsa değer varyant düzeyinde tutulur, ürün düzeyinde ayrıca girilmez. Serbest metin varyantlarda ürün düzeyindeki alanlar bütün varyantlar için ortaktır (§3.4). |
| — | Çok değerli alanlar | Mümkünse tek seçim ve birleşik seçenekle çözülür (ör. Sezon: Yaz / Kış / 4 Mevsim). Kaçınılmaz durumlarda değerler `;` ile ayrılır. |
| — | Excel sürümü | Her şablonun kendi uyumluluk sürümü vardır; yalnız uyumsuz değişiklik sürümü artırır ve yalnız o şablonun eski dosyaları reddedilir (§3.4). |
| — | Diğer varsayılanlar | Beden ve hacim filtresi yalnız stoğu olan varyantlara bakar; Kozmetik ve Elektronik dalları Hepsiburada yapısı örnek alınarak hazırlandı (onaya tabi). |

---

## 3. Codex planında yapılacak değişiklikler

İşaretler: **KALDIR** · **DEĞİŞTİR** · **EKLE** · **KALIR** (değişmeden uygulanır).

### 3.1 Codex §1 — Hedef ve kararlar

- **DEĞİŞTİR:** "Excel'deki 3 ana, 23 alt-1 ve 310 alt-2 kategori, mevcut Ev/Ofis ağacına eklenecek" → Bu belgedeki §5 ağacı eklenecek (7 ana, 50 alt-1, 280 yaprak). Ev ve Ofis ağacına dokunulmaz.
- **KALDIR:** "Kadın, Erkek ve Anne&Çocuk altındaki aynı adlı kategoriler ayrı yollar olarak korunacak."
- **KALIR:** Tasarımcı en alt kategoriyi seçer. Boş kategori müşteriden gizlenir; taslak veya onay bekleyen ürün görünürlük oluşturmaz, yayındaki ürün ilgili yaprağı ve üst dallarını görünür yapar. Admin kategori ekler, adını ve sırasını düzenler; taşıma ve silme bu sürümde yok. Şablonlar kategoriye göre üretilir; filtreler kategorideki ürünlerin özelliklerinden oluşur.
- **EKLE:** Admin kategori eklerken bir şablon seçer; varsayılan, üst dalın şablonudur. Kategori formunda KDV alanı yoktur.

### 3.2 Codex §2 — Kategori ve admin yönetimi

- **DEĞİŞTİR:** Kategori ekleme işleminin kaynağı Excel değil, bu belgenin §5 ağacıdır. İşlem tekrar çalıştırılabilir (idempotent) olur, mevcut kayıtlara ve Ev/Ofis'e dokunmaz; üretimde genel seed çalıştırılmaz.
- **KALIR:** Slug'lar tam kategori yolundan üretilir; ad değişikliği URL'yi değiştirmez; aynı ebeveyn altında aynı ad engellenir; ürün bağlı bir yaprağa alt kategori eklenemez; kategori işlemleri admin işlem günlüğüne yazılır; tasarımcının kategori talebi mevcut destek bağlantısıyla yapılır.
- **EKLE — ana kategori slug'ları:** `giyim`, `ayakkabi`, `taki-aksesuar` (görünen ad "Aksesuar"), `anne-cocuk`, `kozmetik-kisisel-bakim`, `elektronik`, `spor-outdoor`.
- **EKLE — slug çakışma kuralı:** `mobilya`, `aydinlatma` ve `aksesuar` sanal koleksiyon adresleridir (`apps/web/src/config/storefront-nav.ts`). Kategori sayfası tek parçalı adreste önce sanal koleksiyonu açar. Bu yüzden hiçbir kategori (admin'in sonradan açtıkları dahil) bu slug'ları alamaz; sunucu reddeder.
- **EKLE — tasarımcı ekranı:** Tekli ve toplu yüklemede ana kategori listesi veritabanından, şu sırayla gelir: Ev, Ofis, Giyim, Ayakkabı, Aksesuar, Anne & Çocuk, Kozmetik & Kişisel Bakım, Elektronik, Spor & Outdoor. Kodda sabit duran `'ev' | 'ofis'` sınırı (`BULK_TEMPLATE_AREA_SLUGS`, `bulk-import-form.tsx`) kalkar.
- **DEĞİŞTİR — mağaza menüsü:** "Yeni ana kategoriler müşteri menüsüne otomatik katılacak; mevcut vitrin bağlantıları korunacak" yerine:
  - Üst menü = ana kategoriler (veritabanı sırası) + en sonda "İndirim".
  - Mobilya, Mutfak & Sofra, Aydınlatma, Dekorasyon, Aksesuar ve Tekstil üst menüden çıkar; Ev ve Ofis'in açılır menüsünde durur.
  - Açılır menü iki seviye gösterir: alt-1 başlık ve altındaki yapraklar. Mobil menü de aynı yapıdadır.
  - `/kategori/mobilya`, `/kategori/aydinlatma`, `/kategori/aksesuar` sanal koleksiyon sayfaları ve adresleri kalır (SEO); yalnız menüde görünmez.
  - Ürünü olmayan ana kategori ve dallar menüde de görünmez.

### 3.3 Codex §3 — Özellik altyapısı

- **KALIR:** Ortak özellik tanımları, kategori bağlantıları ve ürün/varyant değerleri için genişletilebilir model. Mevcut renk/materyal kayıtları ve kimlikleri korunur. Admin alan ve seçenek tanımlar; tasarımcı yeni özellik başlığı açamaz. Eksik eski ürün özellikleri tahminle doldurulmaz.
- **DEĞİŞTİR — miras kuralı:** "Üst kategoride tanımlanan alanlar alt dallara geçecek; en yakın kategori tanımı öncelikli olacak" yerine **şablon yöntemi**:
  - **Şablon** = alan seti + tek varyant alanı + seçenek listeleri + zorunluluklar + görünen ortak alanlar + uyumluluk sürümü.
  - Her kategori bir şablon kullanır. Şablonu atanmamış kategori üst dalının şablonunu kullanır. Admin herhangi bir dalda başka şablon seçebilir. Yeni açılan dal otomatik olarak üstünün şablonunu alır.
  - Örnek: `Ayakkabı` dalları `AYK` şablonunu kullanır. `Ayakkabı > Ayakkabı Bakım & Aksesuar` ise `AYK-BAKIM` kullanır; ayakkabı boyası yüklenirken numara sorulmaz.
- **DEĞİŞTİR — ilk kurulum profilleri:** Codex §3'teki "Ürün grubu / Başlangıç alanları" tablosu yerine bu belgenin §4.3 şablonları kullanılır.
- **DEĞİŞTİR — 310 yaprağa profil eşlemesi:** §5'te her alt-1 dalın şablonu, farklı şablon kullanan yapraklarla birlikte yazılıdır. Ek B her şablonun kullanıldığı yaprakları listeler.
- **DEĞİŞTİR — alan türleri:**
  - Cinsiyet, Yaş Grubu, Kullanım ve Sezon **tek seçimli** liste. "Sezon birden fazla değer kabul edecek" kuralı kaldırılır.
  - Büyük Beden ve Tesettür Evet/Hayır.
  - Beden: ortak sözlükten, şablon ve yaş grubuna göre alt küme (§4.2).
  - Ölçü, Ton, Uyumlu Model: serbest metin.
  - **Sayısal alanlar:** her ölçüm türü ayrı bir anahtar, tek kanonik birim (§4.4). Farklı ölçüm türleri (hacim, ağırlık, adet) tek alanda karıştırılmaz.
  - **Net İçerik** bir alan değil, **grup zorunluluğudur:** `hacim_ml`, `net_agirlik_g` ve `paket_adedi` alanlarından şablonun izin verdiklerinin en az biri dolu olmalıdır. Fondöten ml, ruj g, ped ve bebek bezi adet ile girilir. Filtrede hacim, ağırlık ve adet ayrı başlıklarda görünür.
- **KALDIR:** "Hedef kitle alanları yalnız ilgili ürün türlerinde kullanılacak. Belirgin kategori yollarında varsayılan değer gösterilecek; kategoriyle çelişen giriş reddedilecek." Cinsiyet artık daldan türemiyor.
- **DEĞİŞTİR — zorunluluk:**
  - Başlangıçta yalnız §4.3'te `*` ile işaretli alanlar ve gruplar zorunludur (öneri; admin değiştirebilir).
  - **Kural:** Bir şablondaki zorunlu alan, o şablonu kullanan her yaprak için anlamlı olmalıdır. Değilse yaprak ayrı şablona alınır. Örnek: makyaj fırçası `KOZ-MAKYAJ` yerine `KOZ-ARAC` kullanır; net içerik sorulmaz.
  - Zorunluluk şu işlemlerde **hedef şablona göre** denetlenir:
    - yeni ürün oluşturma (tekli form ve Excel);
    - **kategori değişikliği** (tasarımcı ya da admin). Örnek: Ev'de oluşturulmuş taslak ürün Giyim'e taşınırken Cinsiyet ve Yaş Grubu boşsa kayıt reddedilir.
  - Kategori değişmeden yapılan düzenlemede dolu bir zorunlu alan boşaltılamaz. Zaten boş olan zorunlu alan doldurulmaya zorlanmaz; bu, sonradan zorunlu yapılan alanlarda eski ürünlerin muafiyetidir.
  - Varyant düzeyinde tutulan zorunlu alanlar (ör. parfümde Hacim, bebek bezinde Paket Adedi) varyantlı üründe her varyant için denetlenir. Net İçerik varyantlı üründe grup zorunluluğu, ürün için seçilen ölçüm türüyle her varyantta denetlenir.
- **EKLE — şablon değişikliklerinde veri koruma:**
  1. Ürün değerleri sabit alan anahtarı ve seçenek kimliğiyle saklanır. Hiçbir şablon değişikliği ürün değeri silmez.
  2. **Alan şablondan çıkarılırsa** değer saklanır. Form, Excel, ürün sayfası ve filtrelerde gösterilmez. Alan geri eklenirse değer yeniden görünür.
  3. **Seçenekler silinmez, pasifleştirilir.** Pasif seçenek yeni girişte seçilemez. Onu kullanan mevcut ürünlerde değer kalır, ürün sayfasında ve filtrede görünmeye devam eder. Admin pasifleştirmeden önce seçeneği kullanan ürün sayısını görür. Seçenek adı değişikliği kimliği değiştirmez; geçmiş sipariş belgeleri (snapshot) etkilenmez.
  4. **Zorunluluk muafiyeti:** Yukarıdaki zorunluluk kuralı uygulanır. Zorunluluk eklemek mevcut ürünü yayından kaldırmaz.
  5. **Birim:**
     - Ürünlerde en az bir kez kullanılmış bir alanın **kanonik birimi ve ölçüm türü değiştirilemez**; sunucu isteği reddeder. Aksi halde "10 cm" olarak girilmiş değer "10 mm" diye okunabilir.
     - **Gösterim birimi** değiştirilebilir (ör. hacim ml yerine L gösterilir). Değer kanonik birimden çevrilerek gösterilir.
     - Farklı bir ölçüm türü gerekiyorsa **yeni alan anahtarı** açılır.
     - Kullanılmamış alanda kanonik birim serbestçe değiştirilebilir.
  6. **Varyant alanının değişmesi** (ör. Beden yerine Ölçü) uyumsuz değişikliktir. Mevcut varyant değerleri kendi anahtarlarında kalır. Admin onaylamadan önce etkilenen ürün sayısını görür. Şablonun uyumluluk sürümü artar.
  7. **Bir dala başka şablon atanırsa** yeni şablonda olmayan alanlar (2)'deki gibi gizlenir, değerleri saklanır. Admin onay ekranında etkilenen ürün sayısını görür.
  8. Şablon, alan, seçenek, birim ve zorunluluk değişiklikleri admin işlem günlüğüne önceki ve yeni değerleriyle yazılır.
  9. **Tasarımcının kategori değişikliği** (yalnız hiç yayımlanmamış üründe):
     - Kaydetmeden önce, yeni şablonda karşılığı olmadığı için silinecek alanlar ve değerleri listelenir; hedef şablonun eksik zorunlu alanları da istenir.
     - Tasarımcı onaylarsa uyumsuz değerler silinir.
     - Sunucu aynı listeyi önizleme cevabında döner ve onaysız isteği reddeder.
- **DEĞİŞTİR:** "Bağımsız Elektronik veya Kozmetik ana kategorisi şimdi oluşturulmayacak" → Elektronik ve Kozmetik & Kişisel Bakım ana kategorileri şimdi oluşturulur (§5).

### 3.4 Codex §4 — Dinamik şablonlar, arayüzler ve filtreler

- **KALIR:** Tek şablon üreticisi; tekli ekleme/düzenleme ekranı aynı tanımları okur; Excel'de seçenek listeleri, birimler ve açıklamalar; gizli metadata; satır, alan ve hata nedeniyle doğrulama; varyantlarda ayrı barkod ve stok.
- **EKLE — görünen ortak alanlar:** Şablon, ortak alanlardan Renk 1/2, Materyal ve En/Boy/Yükseklik'in görünüp görünmeyeceğini belirler (ör. Kozmetik'te Materyal gizli). Model Kodu, Ürün Adı, Kategori, Fiyat, Sevk Süresi, Stok, Barkod, açıklamalar ve görseller her şablonda vardır. Ortak "Ağırlık" alanı (`Product.weight`, kg) gönderim ağırlığıdır; içerik ağırlığı olan `net_agirlik_g` ile karıştırılmaz.
- **DEĞİŞTİR — varyant alanı:**
  - **Bir şablonun tek varyant alanı vardır:**
    - Beden (sözlük alt kümesi)
    - Hacim (sayı, `hacim_ml`)
    - Net İçerik (kozmetik ve bebek bakımda; tasarımcı ürün için ölçüm türünü bir kez seçer: şablonun izin verdiği ml, g ya da adet; bütün varyantlar aynı türde girilir ve ilgili anahtara yazılır)
    - Bez Numarası (liste)
    - Ölçü, Ton, Uyumlu Model (serbest metin)
    - ya da varyant yok
  - **Anahtarlı varyant alanı** (Beden, Hacim, Net İçerik, Bez Numarası): değer varyant düzeyinde tutulur.
    - Varyantlı üründe her varyant kendi değerini taşır; ürün düzeyinde aynı alan ayrıca girilmez.
    - Varyantsız üründe değer ürün düzeyinde girilir.
    - **Ürün sayfası** seçili varyantın değerini gösterir. "Ürün Özellikleri" tablosu varyant değerlerini aralık olarak gösterir (ör. "50–100 ml").
    - **Filtre** stoğu olan varyantların değerlerini kullanır.
    - **Sipariş belgesi** ve sipariş satırı, satın alınan varyantın değerini yazar (temel nitelikler; `OrderLine` varyant snapshot'ı).
  - **Serbest metin varyant alanı** (Ölçü, Ton, Uyumlu Model): bir özellik anahtarına karşılık gelmez ve filtrelenmez. Bu şablonlarda ürün düzeyindeki alanlar bütün varyantlar için ortaktır; form ve Excel açıklaması bunu belirtir. Örnek: Ton varyantlı rujda net ağırlık ürün düzeyinde bir kez girilir. Değer varyanta göre değişiyorsa (ör. 300 ml ve 400 ml kupalar Ölçü varyantıyla yüklenmişse) ürün düzeyindeki alan boş bırakılır; boyut bilgisi varyant adında durur.
  - **Renk ve materyal varyant değildir.**
    - Bugün Excel'deki "Varyant Rengi" ve "Varyant Materyali" kolonları ayrıştırılıyor, tekli ürün API'si de varyantta `color`/`material` kabul ediyor; ama iki yol da bu değerleri kaydetmiyor: `bulk/route.ts` içindeki `variantOptions` ve `products/route.ts` içindeki `normalizeVariant` yalnız beden ve ek özelliği yazıyor. Tekli formda bu alanlar yok.
    - Bu kolonlar ve API alanları kaldırılır. Bir modelin farklı renkleri, aynı Model Kodu ile ayrı ürünler olarak yüklenir (mevcut "renk/materyal kardeşi" tasarımı). Dışa aktarma (`export/route.ts`) bu kolonları artık yazmaz.
    - Eski bir dosyada bu kolonlar dolu gelirse satır hatası verir: "Varyant rengi desteklenmiyor; her rengi aynı Model Kodu ile ayrı ürün olarak yükleyin." API'ye varyantta `color` veya `material` gelirse istek reddedilir. Değer sessizce atılmaz.
  - "Ek Özellik Adı/Değeri" kalır. Serbest bir ikinci varyant bilgisidir ve filtrelenmez.
- **EKLE — materyal listesi şablona göre:** Materyal seçenekleri şablona bağlanır (ör. giyimde Pamuk, Viskon; takıda Gümüş, Çelik). Mevcut `CategoryAttributeOption` bağlantısı bu amaçla kullanılır.
- **DEĞİŞTİR — Excel sürümü (şablon bazında):**
  - Excel'in gizli metadata'sı kategori kimliğini, **şablon kodunu** ve **o şablonun uyumluluk sürümünü** taşır.
  - **Uyumlu değişiklik** sürümü artırmaz ve eski dosyalar kabul edilir; yeni isteğe bağlı kolonlar boş sayılır. Uyumlu değişiklikler: isteğe bağlı alan ekleme, seçenek ekleme, açıklama/sıra değişikliği, gösterim birimi değişikliği.
  - **Uyumsuz değişiklik** yalnız o şablonun sürümünü artırır. Uyumsuz değişiklikler: zorunlu alan veya grup ekleme, alan kaldırma, varyant alanı değişikliği.
  - O şablonla indirilmiş eski dosya reddedilir: "Şablon güncellendi, yeni şablonu indirin" ve değişiklik özeti. **Başka şablonlar etkilenmez:** `AYK` değişikliği `EV-MOBILYA` dosyalarını geçersiz kılmaz.
  - Pasifleştirilmiş bir seçeneği kullanan satır, satır hatası verir.
  - **Varyant kolonu** şablonun varyant alanıdır (ör. `GIY-UST`'te "Beden", `KOZ-PARFUM`'da "Hacim (ml)", `BEB-BEZ`'de "Bez Numarası"). Net İçerik varyantlı şablonlarda ürünün ölçüm türü için ayrıca "Net İçerik Birimi" (ml · g · adet) kolonu bulunur; aynı ürünün satırlarında birim aynı olmalıdır.
  - **Bugünkü (metadata'sız) Excel dosyaları** yalnız Ev/Ofis kategorilerinde kabul edilir; yeni ana kategoriler zaten bu dosyalarda yoktur. Kabul, Ev/Ofis şablonlarının uyumluluk sürümü 1 kaldıkça sürer.
    - Bugünkü başlık eşlemeleri (Renk 1, Ürün Grup Kodu gibi eski başlıklar) korunur.
    - "Beden" kolonu "Ölçü" olarak okunur.
    - "Varyant Rengi" veya "Varyant Materyali" dolu satır hata verir (yukarıya bakın).
  - Beden sözlüğünü kullanan şablonlarda izinli alt kümede olmayan değer (ör. "Medium" ya da yetişkin üründe "6-9 Ay") satır hatası verir.
  - Sayısal kolonlar kanonik birimde girilir; kolon başlığı ve açıklaması birimi gösterir (ör. "Hacim (ml)").
  - Çok değer yazılması gereken alanlarda ayraç `;`'dir.
- **EKLE — sayısal alanlar:**
  - Her sayısal alan §4.4'teki bir anahtara bağlıdır. Değer o anahtarın **kanonik biriminde** sayı olarak saklanır.
  - Girişte izinli başka birimler çevrilir (ör. depolama: 1 TB = 1000 GB; hacim: 1 L = 1000 ml; pil ömrü: 1 gün = 24 saat). Şablon yalnız **gösterim birimini** seçer: Çanta hacmi ve kettle kapasitesi L, parfüm ml gösterilir; ikisi de `hacim_ml` anahtarında saklanır.
  - "64+ GB", "2 TB+", "240+ Hz", "10 ATM+" gibi kova değerleri saklanmaz. Form ve Excel hazır değerleri yalnız giriş kolaylığı olarak sunar (ör. RAM için 8 · 16 · 32 · 64 · 96 · 128 GB); başka bir sayı da girilebilir.
  - Filtre gerçek değerlerle çalışır: Kategorideki ürünlerde bulunan farklı değer sayısı 12 veya azsa değerler onay kutusu olarak gösterilir (ör. 8 GB · 16 GB · 96 GB), fazlaysa en az–en çok aralığı gösterilir.
  - Etiketle gösterilen sayılar da sayı olarak saklanır: Oyuncakta "3+ Yaş" etiketi, `minimum_yas_ay = 36` değerinden üretilir.
- **EKLE — kategori kilidi:**
  - Yeni alan `Product.firstPublishedAt`: ürün ilk kez `published` durumuna geçtiğinde yazılır, bir daha değişmez.
  - Bu alan bir **veritabanı tetikleyicisiyle** korunur: durum `published` olurken alan boşsa doldurulur; dolu değer güncellenemez ve boşaltılamaz. Böylece yayımlayan her kod yolu kapsanır: tekli onay, toplu onay, otomatik onay ve düzenleme sonrası onay.
  - `publishedAt` bu iş için kullanılamaz: yayından kaldırmada ve içerik düzenlemesiyle ürün yeniden onaya düştüğünde sıfırlanıyor (`api/services/catalog.service.ts`).
  - **Kilit:** `firstPublishedAt` doluysa ya da ürünün en az bir sipariş satırı varsa tasarımcının kategori değişikliği sunucuda reddedilir ve seçici kilitli görünür. Admin ürün detayından kategoriyi değiştirebilir; hedef şablonun zorunlu alanları istenir ve işlem günlüğe yazılır.
  - **Geçmiş kayıtların doldurulması** tek seferlik bir geçişle yapılır. Önce dry-run raporu alınır; rapor her ürün için kullanılan kaynağı ve tarihi listeler. Uygulama rapor incelendikten sonra yapılır:
    1. `publishedAt` doluysa: bu tarih ile aşağıdaki kanıtların en eskisi alınır.
    2. `publishedAt` boşsa yayın kanıtlarının en eski tarihi alınır. Kanıtlar:
       - `OrderLine`
       - `ProductAnalyticsEvent` (yalnız ürün yayındayken yazılıyor)
       - `FavoriteProduct` (yalnız yayındaki ürün favorilenebiliyor)
       - `CartItem` (sepete yalnız yayındaki ürün ekleniyor)
       - `ProductReview`
       - `ProductQuestionThread` (satış öncesi soru yalnız yayındaki ürüne açılıyor)
       - Önceki durumu `published` olan `AdminAuditLog` `product_unlisted` kaydı
    3. Kanıt yok ama durum `unlisted` ise geçiş anı yazılır ve ürün kilitli sayılır; yayından kaldırma neredeyse her zaman yayından sonra gelir.
    4. Kanıt yok ve durum `draft`, `pending_review` veya `rejected` ise alan boş kalır; ürün hiç yayımlanmamış sayılır. Bu ürünlerin müşteri tarafında izi (sipariş, favori, sepet, görüntülenme) olmadığı için kategori değişikliği hiçbir müşteri kaydını etkilemez. Admin bu ürünlerde de kategoriyi değiştirebilir.
- **DEĞİŞTİR — varyant eşleşmesi ve stok:**
  - **Değişmez kural:** Bir şablonda filtrelenebilir **en fazla bir varyant boyutu** vardır: şablonun anahtarlı varyant alanı. Serbest metin varyantlar ve Ek Özellik filtrelenmez; renk ve materyal ürün düzeyindedir. Bu yüzden farklı varyantların değerlerinin birbirine karışması (M + Mavi sorunu) yapısal olarak oluşmaz. İleride ikinci bir filtrelenebilir varyant boyutu eklenirse arama, varyant başına belge yöntemine geçmelidir.
  - **Stok kuralı:**
    - Filtresiz listeleme ve aramada ürünler stok durumundan bağımsız görünür (bugünkü müşteri görünürlüğü korunur).
    - Varyant alanına göre filtre (beden, hacim, net içerik, bez numarası) seçildiğinde yalnız **stoğu olan** varyantların değerleri eşleşir.
    - "Stokta" filtresi bugünkü anlamıyla kalır: ürün stoğu sıfırdan büyük. Varyantlı üründe ürün stoğu, varyant stoklarının toplamıdır (tasarımcı panelindeki oluşturma, düzenleme, toplu yükleme ve varyant güncelleme yolları bu toplamı yazıyor).
  - **Bugünkü stok tutarsızlığı (düzeltilir):**
    - Sipariş (`checkout.service.ts`) ve iptal/iade stok iadesi (`order-line-release.ts`) varyantlı üründe yalnız varyant stoğunu değiştiriyor; ürün stoğu güncellenmiyor. Sonuç: bütün varyantları tükenmiş ürün "Stokta" filtresinde ve aramadaki `stock` alanında stokta görünmeye devam edebilir.
    - Bu iki yol da arama indeksini tetiklemiyor; indeksi bugün yalnız ürün kaydı ve kategori işlemleri güncelliyor (`catalog.service.ts`).
    - **Düzeltme:** İki yolda ürün stoğu aynı transaction içinde varyantla birlikte güncellenir. Commit'ten sonra ilgili ürünler için `enqueueProductSync` çağrılır.
  - **Kategori sayfası:** Listeleme bugün ürünleri yükleyip bellekte süzüyor (`catalog.service.listPublishedCurated`).
    - Varyant filtresi tek ifadeyle uygulanır. Bellekte: `variants.some(v => v.stok > 0 && <değer koşulu>)`. Veritabanına taşınırsa: tek bir `EXISTS`.
    - Varyantsız üründe ürün düzeyi değer ve ürün stoğu kullanılır.
  - **Arama (Meilisearch):** Ürün başına **tek belge** kullanılır.
    - Belge, ürün yayında olduğu sürece stoktan bağımsız olarak indekste kalır; stoksuz ürün filtresiz aramada bulunur.
    - Anahtarlı varyant alanının yalnız stoğu olan varyantlardaki değerleri bir dizide tutulur (ör. `beden_stokta`, `hacim_ml_stokta`). Varyantsız üründe ürün düzeyi değer, ürün stoktaysa bu diziye yazılır. Bütün varyantların değerleri ayrıca tutulmaz; filtre kararı gereği yalnız stoktaki değerler eşleşir.
    - Varyant filtresi bu diziye, ürün düzeyi filtreler ürün alanlarına uygulanır. "Stokta" filtresi mevcut `stock` alanını kullanır.
    - **Sayısal aralık** dizide tek bir `TO` koşuluyla yazılır (ör. `hacim_ml_stokta 90 TO 110`). İki ayrı karşılaştırma (`>= 90 AND <= 110`) farklı elemanlarla eşleşebileceği için kullanılmaz: 50 ve 200 ml varyantlı ürün, iki koşulu ayrı ayrı sağlar ama aralıkta değeri yoktur.
    - `distinct` gerekmez; facet sayıları doğrudan ürün sayısıdır.
    - Stoğu değiştiren her yol ürünün belgesini yeniden indeksler: tasarımcı düzenlemesi, toplu yükleme, sipariş ve iptal/iade (yukarıdaki düzeltme).
  - Meilisearch bugün `getmeili/meilisearch:latest` imajıyla çalışıyor (`docker-compose*.yml`). Sürüm sabitlenmeli; facet sayıları ve dizi üzerinde `TO` davranışı seçilen sürümde testle doğrulanmalıdır.
- **KALIR — arayüzler:** Admin kategori API'si (listeleme, oluşturma); özellik tanımı API'leri; kategori özellik cevabının `definitions` ve `schemaVersion` ile genişlemesi; ürün ve varyant isteklerine `properties`; listeleme sorgularında çoklu seçim ve sayısal aralık.
- **EKLE — admin ekranları:**
  - **Kategori ağacı ekranı:** arama, ana/alt kategori ekleme, ad ve sıra düzenleme, şablon seçimi.
  - **Şablon ve özellik yönetimi ekranı:** alan, seçenek (pasifleştirme dahil), zorunluluk ve grup zorunluluğu, varyant alanı, görünen ortak alanlar, gösterim birimi ve uyumluluk sürümü. Değişiklikten önce etkilenen ürün sayısı gösterilir. Kullanılmış alanın kanonik birimi bu ekrandan değiştirilemez.
  - Bugün admin panelinde kategori ekranı yok; API var ama onu kullanan sayfa yok.
- **KALIR — filtre davranışı:** Filtreler seçilen kategori ve alt dallarındaki görünür ürünlerden üretilir; boş başlık gösterilmez; aynı alan VEYA, farklı alanlar VE ile birleşir; seçili değer sonuç sıfırken de görünür; filtre değişince sayfalama sıfırlanır.
- **EKLE — filtre kuralları:**
  - "Kadın" seçilince Kadın + Unisex, "Erkek" seçilince Erkek + Unisex ürünler gelir. "Unisex" seçeneği yalnız Unisex ürünleri getirir.
  - Yaş grubunda yalnız Çocuk ve/veya Bebek seçiliyse "Kadın" seçeneği "Kız" olarak gösterilir. Tasarımcı ekranında seçenek "Kadın / Kız" olarak görünür.
  - Büyük Beden ve Tesettür onay kutusu olarak görünür (Evet işaretli ürünler).
  - Giyim, Ayakkabı ve Spor & Outdoor'da "Kullanım" filtresi bulunur.
  - Varyant filtresi (beden, hacim…) yukarıdaki stok kuralıyla çalışır ve yalnız ürünlerde gerçekten kullanılan değerleri gösterir.
  - Sayısal alanlar yukarıdaki sayısal alan kuralıyla gösterilir; hacim, net ağırlık ve paket adedi ayrı başlıklardır.
  - Filtreli adresler indekslenmez; canonical temiz kategori adresidir (`.claude/rules/04-seo-rules.md`).
- **EKLE — arama (Meilisearch, Aşama 2):**
  - Arama belgesine kategori yolu (tüm üst dallar), filtrelenebilir ürün özellikleri ve varyant dizisi eklenir.
  - Kategori yolu, cinsiyet ve yaş etiketleri aranabilir alanlara girer. "kadın sweatshirt" araması ürün adında "kadın" geçmese de eşleşir.
  - Arama sonuç sayfasında da özellik filtreleri gösterilir. Kategori sayfası ve arama aynı filtre anlamını ve aynı stok kuralını kullanır.
  - Admin filtrelenebilir yeni bir alan eklediğinde indeks ayarı güncellenir ve yeniden indekslenir. Dağıtımdan sonra tam yeniden indeksleme yapılır.
  - Bugün indekste yalnız yaprak kategori adı ve slug'ı var (`api/domain/search.ts`).
- **EKLE — ürün sayfası ve sözleşme (Aşama 1):**
  - Ürün sayfasına doldurulmuş alanlardan oluşan "Ürün Özellikleri" tablosu eklenir; varyant düzeyindeki değerler yukarıdaki kuralla gösterilir.
  - `api/domain/product-characteristics.ts` genişletilir. Ürün sayfası ve Mesafeli Satış Sözleşmesi / Ön Bilgilendirme Formu'ndaki "temel nitelikler" bu tek kaynaktan üretilir; sipariş belgelerine satın alınan varyantın değeri yazılır.
  - Belgeler bugün `distance-sales-2026-10-12-v5` ve `pre-information-2026-10-12-v5` sürümünde (`api/lib/legal-documents.ts`). Yeni içerik için **yeni tarihli v6** sürümleri tanımlanır (`distance-sales-<tarih>-v6`, `pre-information-<tarih>-v6`).
  - Mevcut siparişlerin belgeleri (`OrderLegalSnapshot`) değişmez.
- **EKLE — etkilenen yerler:** Renk/materyal modelinin genişlemesi ve şablonlar şu dosyalarda değişiklik gerektirir:
  - **Şema ve seed:**
    - `db/schema/schema.prisma`: `ProductAttributeType` yalnız `color | material`. `Product.firstPublishedAt` ve tetikleyici eklenecek. Sayısal değerler için anahtar ve kanonik birim alanları eklenecek.
    - `db/seeds/attribute-options.ts`: beden sözlüğü ve özellik değerleri. Üretimde tek seferlik, idempotent bir komutla yüklenir.
  - **Tasarımcı paneli:**
    - `lib/bulk-category-options.ts`, `lib/bulk-product-import.ts` ("Varyant Rengi" ve "Varyant Materyali" kolonlarının kaldırılması ve hata kuralı dahil).
    - `api/seller/products/bulk/template/route.ts`; `api/seller/products/bulk/route.ts` (`variantName`, `variantOptions`).
    - `api/seller/products/route.ts` (`variantSchema` içindeki `color`/`material`, `normalizeVariant`); `api/seller/products/export/route.ts` (Varyant Rengi/Materyali kolonları).
    - `api/categories/[slug]/attributes/route.ts`, `api/attribute-options/route.ts`.
    - `urunler/yeni/_components/new-product-form.tsx`, `urunler/[id]/_components/product-edit-form.tsx`, `urunler/_components/category-picker.tsx`, `urunler/toplu-yukle/_components/bulk-import-form.tsx`.
  - **Admin paneli:** `lib/bulk-category-options.ts`, yeni kategori ağacı ve şablon ekranları, ürün detayında özellikler ve kategori değiştirme.
  - **Mağaza:** `config/storefront-nav.ts`, `lib/storefront-nav-menu.ts`, `packages/ui` MegaMenu, `(storefront)/page.tsx` (ana sayfa kartları), `urun/[slug]/page.tsx`, `kategori/[...slug]/page.tsx`, `lib/product-listing-query.ts`, kategori filtre bileşeni.
  - **API:**
    - `api/domain/product-characteristics.ts`, `api/lib/legal-documents.ts`.
    - `api/services/checkout.service.ts` (sözleşme v6; varyantlı üründe ürün stoğu ve arama senkronu), `api/services/order-line-release.ts` (stok iadesinde ürün stoğu ve arama senkronu).
    - `api/services/catalog.service.ts` (kategori kilidi, varyant filtresi), `api/repositories/product.repository.ts`.
    - `api/domain/search.ts`, `api/services/search.service.ts`, `api/jobs/search-index-sync.job.ts`.
  - **Araçlar:** `tools/catalog-import` (`runner.ts`, `mapping.ts`; renk/materyal tipine bağlı).
  - **Altyapı:** `docker-compose.yml` ve `docker-compose.production.yml` dosyalarında Meilisearch sürümünü sabitleme.
  - **Temizlik:** `api/services/product-import/import.service.ts` uygulamada hiçbir yerden çağrılmıyor ama tasarımcı adına kategori açabiliyor; "kategoriyi yalnız admin ekler" kuralıyla çelişir.
    - Kaldırılır; bağlı testler de aynı işte ele alınır: `tests/unit/product-import-service.test.ts` ve `tests/integration/import-commit-barcode-conflict.test.ts`.
    - Bu testlerde yalnız kaldırılan servise ait senaryolar silinir. Hâlâ geçerli bir kuralı (ör. barkod çakışması) koruyan senaryo, kuralın bugün çalıştığı yola taşınır.
    - `product-import/barcode.ts` kalır; `barcode/check` route'u onu kullanıyor.

### 3.5 Codex §5 — Test, geçiş ve kabul

- **DEĞİŞTİR:** "336 kaynak düğümü mevcut ağaçla doğru birleşmeli" → §5 ağacı (337 yeni düğüm) tekrar çalıştırıldığında mükerrer kayıt oluşmamalı; Ev/Ofis değişmemeli.
- **DEĞİŞTİR:** "Kadın/Erkek/çocuk Sweatshirt dalları ayrı kalmalı" → Tek `Giyim > Üst Giyim > Sweatshirt` dalı olmalı. Kadın filtresi Kadın+Unisex, Erkek filtresi Erkek+Unisex, Unisex filtresi yalnız Unisex döndürmeli.
- **DEĞİŞTİR:** "310 yaprağın hiçbirinde profil eşlemesi eksik kalmamalı" → Her yaprak bir şablona çözümlenmeli (doğrudan ya da üst dalından).
- **DEĞİŞTİR (sürüm 1'deki çelişki giderildi):** "Eski Excel davranışları korunmalı" yerine:
  - Bugünkü (metadata'sız) Ev/Ofis Excel'leri, Ev/Ofis şablonlarının uyumluluk sürümü 1 kaldıkça kabul edilmeli.
  - Uyumsuz değişiklik yapılmış bir şablonun eski dosyası reddedilmeli; diğer şablonların dosyaları etkilenmemeli (§3.4).
  - Barkod, model gruplama ve varyant stok davranışları korunmalı.
- **KALIR:** Admin'in eklediği kategori ve özellik kod değişikliği olmadan tasarımcı ekranına ve yeni Excel'e yansımalı; ilgili testler ve depo release kontrolleri tamamlanmalı.
- **EKLE — test yöntemi:** Her aşama yerelde üç panel (mağaza, tasarımcı, admin) üzerinden gerçek kullanıcı gibi, tarayıcı veya bilgisayar kullanımı skill'iyle uçtan uca test edilir. Birim, entegrasyon ve Postgres testleri buna ek olarak çalışır.
- **EKLE — Aşama 1 senaryoları:**
  1. Admin yeni bir ana kategori ekler → tasarımcının yükleme ekranında görünür; ürün yayınlanana kadar mağazada (menü dahil) gizli kalır.
  2. Admin ürün bağlı bir yaprağa alt kategori eklemeyi dener → reddedilir. Admin `aksesuar` slug'ıyla kategori açmayı dener → reddedilir.
  3. Tasarımcı tekli formla `Giyim > Üst Giyim > Sweatshirt` ekler: Cinsiyet Unisex, Yaş Yetişkin, M ve L beden varyantları. Zorunlu alan boşsa form gönderilmez.
  4. Tasarımcı aynı dalın Excel şablonunu indirir: kolonlar `GIY-UST` alanlarıdır. Listede olmayan beden ("Medium") ve yetişkin üründe "6-9 Ay" satır hatası verir. "Varyant Rengi" dolu satır hata verir. Tekli ürün API'sine varyantta `color` gönderilirse istek reddedilir.
  5. **Zorunlu alan kontrolü (snapshot):** Ek B'deki her yaprak için oluşturma formundaki zorunlu alan ve grup listesi beklenen tabloyla karşılaştırılır. Makyaj fırçası net içerik istemez. Ruj net ağırlıkla, bebek bezi paket adediyle kabul edilir.
  6. **Kategori değişikliği ve zorunluluk:** Ev'de oluşturulan taslak ürün Giyim'e taşınırken Cinsiyet ve Yaş Grubu boşsa kayıt reddedilir, doldurulunca kabul edilir. Admin'in kategori değişikliğinde de hedef şablonun zorunlu alanları istenir.
  7. **Beden alt kümesi:** Ayakkabı formunda sütyen bedenleri, yetişkin giyimde ay bedenleri görünmez. Excel'in bağımlı listesi ve sunucu doğrulaması da aynı kuralı uygular.
  8. **Varyant hacmi:** 50 ml ve 100 ml varyantlı parfümde ürün düzeyinde hacim istenmez; her varyantta zorunludur. Ürün sayfası seçili varyantın hacmini, özellik tablosu "50–100 ml" gösterir. 100 ml varyantı satın alınınca sipariş belgesinde 100 ml yazar.
  9. **Birim:** Ürünlerde kullanılmış bir alanın kanonik birimini değiştirme isteği reddedilir. Gösterim birimi değişikliği kabul edilir ve değerler çevrilerek gösterilir. Kettle kapasitesi L girilir, `hacim_ml` olarak saklanır.
  10. **Şablon sürümü:** `AYK`'ye zorunlu alan eklenince eski `AYK` Excel'i reddedilir, `EV-MOBILYA` Excel'i kabul edilir. `AYK`'ye isteğe bağlı alan veya seçenek eklenince eski `AYK` Excel'i kabul edilir. Bugünkü metadata'sız Ev/Ofis Excel'i kabul edilir.
  11. **Veri koruma:** Şablondan çıkarılan alan geri eklenince değer geri gelir. Pasifleştirilen seçenek mevcut üründe görünmeye devam eder, yeni girişte seçilemez. Taslak üründe kategori değiştirilirken silinecek alanlar kaydetmeden önce listelenir.
  12. **Kategori kilidi:** Yayından kaldırılmış (`publishedAt` boş) ama siparişi olan ürün kilitlidir. Bir kez yayımlanmış üründe seçici kilitlidir. Tetikleyici dolu `firstPublishedAt` değerinin değiştirilmesine izin vermez. Geçişin dry-run raporu her ürün için kaynağı gösterir.
  13. **Stok tutarlılığı:** Varyantlı bir ürünün son stoğu sipariş edilince ürün stoğu 0 olur ve ürün "Stokta" filtresinden düşer. Sipariş iptal edilip stok iade edilince ürün geri gelir.
  14. Tasarımcı `Ev > Ev Tekstili > Halı & Kilim` ürününü 160x230 ve 200x290 ölçü varyantlarıyla yükler → kabul edilir.
  15. Admin onaylar → Giyim menüde belirir; Ev/Ofis değişmez; ürünü olmayan ana kategoriler görünmez.
  16. Menü sırası 9 ana kategori + İndirim'dir. Aksesuar `/kategori/taki-aksesuar`'a gider. `/kategori/aksesuar` eski ev+ofis sayfasını açar. Mobil menü aynı yapıdadır.
  17. Ürün sayfasında "Ürün Özellikleri" tablosu görünür. Yeni sipariş **v6** belgeleriyle oluşur; eski sipariş v5 belgesiyle açılır.
  18. Admin bir alanı zorunlu yapar → yeni ürün formunda ve Excel'de zorunlu olur; eski ürün kategori değişmeden düzenlenirken zorlanmaz; dolu değer boşaltılamaz.
- **EKLE — Aşama 2 senaryoları:**
  1. **Renk + beden (zorunlu):** Aynı Model Kodu ile iki ürün: Kırmızı (M stok 3, L stok 0) ve Mavi (L stok 5). Ürünler hem tekli formla hem Excel'le yüklenir. Beklenen sonuçlar kategori sayfasında da aramada da aynıdır:

     | Filtre | Sonuç |
     |---|---|
     | M + Mavi | sonuç yok |
     | M + Kırmızı | Kırmızı |
     | L + Kırmızı | sonuç yok (stok 0) |
     | L | Mavi |
  2. **Stoksuz ürün:** Bütün varyantları tükenmiş yayımlanmış ürün filtresiz aramada ve kategori sayfasında bulunur. Beden filtresinde ve "Stokta" filtresinde bulunmaz.
  3. **Stok değişimi ve indeks:** Kırmızı M'nin 3 adedi sipariş edilince "M" filtresi aramada ve kategori sayfasında Kırmızı'yı artık getirmez. Sipariş iptal edilip stok iade edilince yeniden getirir.
  4. Facet sayıları ürün sayısını gösterir (sabitlenmiş Meilisearch sürümünde çalıştırılarak doğrulanır).
  5. **Sayısal:** 96 GB RAM'li ürün "96 GB" seçeneğinde ve 64–128 aralığında bulunur. Hacim filtresi 90–110 ml aralığında parfümü yalnız 100 ml varyantı stoktaysa getirir. 50 ve 200 ml varyantlı ürün 90–110 ml aralığında bulunmaz. Hacim, net ağırlık ve paket adedi ayrı filtre başlıklarıdır.
  6. Kadın/Erkek/Unisex kuralı; "Kız" etiketi; Büyük Beden, Tesettür ve Kullanım filtreleri.
  7. "kadın sweatshirt" araması.
  8. Sonsuz kaydırma ve toplam sayı aynı filtre mantığını kullanır.
- **DEĞİŞTİR — dağıtım:**
  - **Aşama 1:** Ağaç, admin kategori ve şablon ekranları, özellik/şablon altyapısı, sayısal anahtarlar, dinamik Excel ve form, beden alt kümeleri, varyant alanı kuralları, varyant rengi/materyalinin kaldırılması, kategori kilidi ve geçmiş kayıt geçişi, varyantlı üründe sipariş/iptal stok tutarlılığı ve arama senkronu, ürün sayfası ve sözleşme v6, menü.
  - **Aşama 2:** Kategori sayfası özellik filtreleri ve arama (Meilisearch, sabitlenmiş sürümle).
  - Her aşama yerel uçtan uca testler tamamlanınca `docs/07-operations/production-deploy-runbook.md` sırasıyla dağıtılır: worker/migration → admin-panel → seller-panel → web. Aşama 2'den sonra tam yeniden indeksleme yapılır.
- **EKLE — Aşama 1 ile Aşama 2 arasındaki geçici mağaza davranışı (bilinçli kabul):**
  - Yeni kategorilerde ürün yayımlanabilir ve menüde görünür.
  - Kategori sayfalarında yalnız bugünkü filtreler bulunur: alt kategori, tasarımcı, fiyat, stok, indirim. Cinsiyet, yaş grubu, beden, kullanım, büyük beden, tesettür ve sayısal özellik filtreleri henüz yoktur.
  - Bu özellikler ürün sayfasındaki "Ürün Özellikleri" tablosunda görünür.
  - Arama bugünkü gibi ürün adı, açıklama ve yaprak kategori adıyla çalışır. "kadın sweatshirt" gibi aramalar ürün adında bu kelimeler yoksa eksik sonuç verebilir.
  - Tasarımcıların girdiği bütün özellikler Aşama 1'den itibaren saklanır; Aşama 2 açıldığında filtrelere ek bir işlem gerekmeden yansır.
- **EKLE — bilinen etkiler (kapsam dışı kararlardan):**
  - **KDV:** Yeni kategorilere oran girilmediği için sistem platform varsayılanı %20'yi kullanır. Admin'in sipariş detayındaki tasarımcı faturası kartı yeni kategorilerde "KDV %20" gösterir. Otomatik faturalamaya kadar admin, tasarımcının faturasındaki oranı kendisi kontrol eder.
  - **Cayma hakkı:** Davranış değişmez.
  - **Gıda:** Ağaçta yok.

---

## 4. Özellik değerleri ve şablonlar

### 4.1 Ortak özellik değerleri

| Alan | Tür | Değerler | Kullanıldığı yer |
|---|---|---|---|
| Cinsiyet | Tek seçim | Kadın (çocukta "Kız") · Erkek · Unisex | Giyim, Ayakkabı, Aksesuar; isteğe bağlı olarak Kozmetik, Oyuncak, kişisel bakım aletleri |
| Yaş Grubu | Tek seçim | Yetişkin · Çocuk · Bebek | Giyim, Ayakkabı, Aksesuar (giyim aksesuarı, çanta), Bisiklet |
| Kullanım | Tek seçim | Giyim/Ayakkabı: Günlük · Spor · Outdoor — Spor & Outdoor: Spor · Outdoor | Giyim, Ayakkabı, Spor & Outdoor |
| Sezon | Tek seçim | Yaz · Kış · 4 Mevsim | Giyim, Ayakkabı, giyim aksesuarı, kamp |
| Büyük Beden | Evet/Hayır | Varsayılan Hayır | Giyim |
| Tesettür | Evet/Hayır | Varsayılan Hayır | Giyim, Atkı/Şal/Eşarp |
| Net İçerik | Grup zorunluluğu | `hacim_ml` · `net_agirlik_g` · `paket_adedi` alanlarından şablonun izin verdiklerinin en az biri | Kozmetik, Anne & Çocuk bakım; ayakkabı ve ev bakımında isteğe bağlı |
| Minimum Yaş | Sayı (`minimum_yas_ay`) | "6+ Ay", "3+ Yaş" gibi etiketle gösterilir | Oyuncak, beslenme, bebek bakım |
| Garanti Süresi | Sayı (`garanti_ay`) | — | Elektronik cihaz şablonlarında zorunlu; aksesuar şablonlarında, saatte ve bisiklette isteğe bağlı |

### 4.2 Beden sözlüğü ve alt kümeler

Tek sözlük (154 benzersiz değer), 14 alt küme. Alt kümeler çakışabilir: "38" hem giyim hem ayakkabı grubunda aynı değerdir. Kategori bağlamı anlamını belirler. Sözlük sırası filtre sırasıdır. Admin değer ekleyebilir ve değeri bir veya daha çok alt kümeye bağlar.

| Kod | Grup | Değerler | Adet |
|---|---|---|---|
| B1 | Harf | XXS · XS · S · M · L · XL · XXL · 3XL · 4XL · 5XL · 6XL | 11 |
| B2 | Kombine harf | XS/S · S/M · M/L · L/XL · XL/XXL · XXL/3XL | 6 |
| B3 | Tek ebat | Standart (Tek Ebat) | 1 |
| B4 | Giyim sayısal | 32 · 34 · 36 · 38 · 40 · 42 · 44 · 46 · 48 · 50 · 52 · 54 · 56 · 58 · 60 | 15 |
| B5 | Kot bel | 24 · 25 · 26 · 27 · 28 · 29 · 30 · 31 · 32 · 33 · 34 · 35 · 36 · 37 · 38 · 39 · 40 · 41 · 42 · 43 · 44 | 21 |
| B6 | Kombine giyim sayısal | 34-36 · 36-38 · 38-40 · 40-42 · 42-44 · 44-46 · 46-48 | 7 |
| B7 | Ayakkabı yetişkin | 35 · 35,5 · 36 · 36,5 · 37 · 37,5 · 38 · 38,5 · 39 · 39,5 · 40 · 40,5 · 41 · 41,5 · 42 · 42,5 · 43 · 43,5 · 44 · 44,5 · 45 · 45,5 · 46 · 46,5 · 47 · 48 | 26 |
| B8 | Ayakkabı çocuk | 23 · 24 · 25 · 26 · 27 · 28 · 29 · 30 · 31 · 32 · 33 · 34 | 12 |
| B9 | Ayakkabı bebek | 16 · 17 · 18 · 19 · 20 · 21 · 22 | 7 |
| B10 | Çorap yetişkin | 35-38 · 36-40 · 39-42 · 40-44 · 43-46 | 5 |
| B11 | Çorap çocuk | 19-22 · 23-26 · 27-30 · 31-34 | 4 |
| B12 | Bebek (ay) | 0-1 Ay · 0-3 Ay · 3-6 Ay · 6-9 Ay · 9-12 Ay · 12-18 Ay · 18-24 Ay | 7 |
| B13 | Çocuk (yaş) | 2-3 Yaş · 3-4 Yaş · 4-5 Yaş · 5-6 Yaş · 6-7 Yaş · 7-8 Yaş · 8-9 Yaş · 9-10 Yaş · 10-11 Yaş · 11-12 Yaş · 12-13 Yaş · 13-14 Yaş · 14-15 Yaş · 15-16 Yaş | 14 |
| B14 | Sütyen | 70A · 70B · 70C · 70D · 70DD · 70E · 75A · 75B · 75C · 75D · 75DD · 75E · 80A · 80B · 80C · 80D · 80DD · 80E · 85A · 85B · 85C · 85D · 85DD · 85E · 90A · 90B · 90C · 90D · 90DD · 90E · 95A · 95B · 95C · 95D · 95DD · 95E · 100A · 100B · 100C · 100D · 100DD · 100E · 105A · 105B · 105C · 105D · 105DD · 105E | 48 |

**Hangi alt küme nerede gösterilir:**
- Form ve Excel yalnız aşağıdaki alt kümeleri sunar.
- Excel'de beden açılır listesi, aynı satırdaki Yaş Grubu'na göre daralır. Mevcut şablondaki kategoriye bağlı renk listesinin bağımlı liste yöntemi kullanılır.
- Sunucu aynı kuralla doğrular.
- Mağaza filtresi yalnız ürünlerde kullanılan ve stoğu olan değerleri gösterir.

| Şablon / yaprak | Yaş Grubu: Yetişkin | Yaş Grubu: Çocuk | Yaş Grubu: Bebek |
|---|---|---|---|
| `GIY-UST`, `GIY-ELB`, `GIY-DIS`, `GIY-TAK`, `GIY-MAYO` | B1 · B2 · B3 · B4 · B6 | B13 · B3 | B12 · B3 |
| `GIY-ALT` | B1 · B2 · B3 · B4 · B5 · B6 | B13 · B3 | B12 · B3 |
| `GIY-IC` (Çorap hariç) | B1 · B2 · B3 · B4 · B6; Sütyen, Bralet, Spor Sütyeni, Büstiyer, Korse, İç Çamaşırı Takımı yapraklarında ek olarak B14 | B13 · B3 | B12 · B3 |
| `GIY-IC` > Çorap | B10 · B2 · B3 | B11 · B3 | B12 · B3 |
| `AYK` (Terlik ve Ev Terliği hariç) | B7 | B8 | B9 · B12 |
| `AYK` > Terlik, Ev Terliği | B7 · B2 · B3 | B8 · B3 | B9 · B12 |
| `AKS-GIYIM` | B1 · B2 · B3 | B13 · B3 | B12 · B3 |

### 4.3 Başlangıç şablonları

`*` önerilen zorunlu alan ya da grup (admin değiştirebilir). Zorunlu alan, şablonu kullanan her yaprakta anlamlıdır (Ek B). Ortak alanlar (§3.4) her şablonda vardır; tabloda yalnız şablona özgü olanlar yazılıdır. Liste değerleri başlangıç önerisidir. Sayısal alanlarda parantez içinde §4.4'teki anahtar ve bu şablondaki **gösterim birimi** yazılıdır; "öneri" değerleri yalnız giriş kolaylığıdır. "Varyant" sütunu şablonun tek varyant alanını gösterir: Beden, Hacim, Net İçerik ve Bez Numarası anahtarlıdır, değeri varyant düzeyinde tutulur; Ölçü, Ton ve Uyumlu Model serbest metindir, filtrelenmez (§3.4).

**Giyim şablonlarının ortak alanları** (`GIY-*` hepsinde):
- **Alanlar:** Cinsiyet\*, Yaş Grubu\*, Kullanım, Sezon, Kalıp (Dar/Slim · Normal · Rahat · Oversize), Desen (Düz · Çizgili · Kareli · Çiçekli · Puantiyeli · Baskılı · Geometrik · Kamuflaj · Hayvan Deseni · Etnik), Kumaş Tipi (Örme · Dokuma · Triko · Denim · Kadife · Saten · Şifon · Polar · Kaşe · Dantel · Tül), Büyük Beden, Tesettür.
- **Materyal listesi:** Pamuk · Organik Pamuk · Polyester · Viskon · Modal · Keten · Yün · Kaşmir · İpek · Akrilik · Poliamid · Elastan · Deri · Suni Deri · Karışım.
- **Varyant alanı:** Beden (§4.2 alt kümeleri).
- En/Boy/Yükseklik gizli.

| Şablon | Kullanıldığı dallar | Varyant | Şablona özgü alanlar |
|---|---|---|---|
| `GIY-UST` | Giyim > Üst Giyim | Beden | Yaka Tipi (Bisiklet · V · Polo · Gömlek · Hakim · Balıkçı · Kapüşonlu · Kare · Straplez · Halter), Kol Boyu (Kolsuz · Kısa · 3/4 · Uzun) |
| `GIY-ALT` | Giyim > Alt Giyim | Beden | Bel (Yüksek · Normal · Düşük), Paça (Dar · Düz · Bol · İspanyol · Jogger), Boy (Mini · Midi · Maksi · Bilek · Standart) |
| `GIY-ELB` | Giyim > Elbise & Tulum | Beden | Yaka Tipi, Kol Boyu, Boy (Mini · Midi · Maksi) |
| `GIY-DIS` | Giyim > Dış Giyim | Beden | Kapüşon (Var · Yok), Kapama (Fermuarlı · Düğmeli · Çıtçıtlı · Kemerli · Açık), Dolgu (Kaz Tüyü · Elyaf · Dolgusuz), Boy (Kısa · Orta · Uzun) |
| `GIY-TAK` | Giyim > Takım & Set | Beden | Parça Sayısı (`parca_sayisi`), Yaka Tipi, Kol Boyu |
| `GIY-IC` | Giyim > İç Giyim & Ev Giyimi | Beden | Paket Adedi (`paket_adedi`), Kap Tipi (Balenli · Balensiz · Dolgulu · Dolgusuz · Toparlayıcı; sütyen grubunda) |
| `GIY-MAYO` | Giyim > Mayo & Plaj | Beden | Giyim ortak alanları yeterli |
| `AYK` | Ayakkabı (Bakım dalı hariç) | Beden (numara) | Cinsiyet\*, Yaş Grubu\*, Kullanım, Sezon, Materyal = dış materyal (Deri · Süet · Nubuk · Rugan · Tekstil · Kanvas · Suni Deri · Kauçuk · Hasır), İç Materyal (Deri · Tekstil · Sentetik), Taban Materyali (Kauçuk · EVA · Termo · Poliüretan · Deri), Bağlama (Bağcıklı · Cırtlı · Fermuarlı · Bağcıksız · Tokalı), Topuk Tipi (Düz · Kalın · İnce · Dolgu · Platform), Topuk Yüksekliği (`topuk_yuksekligi_cm`; cm), Su Geçirmez (Evet/Hayır) |
| `AYK-BAKIM` | Ayakkabı > Ayakkabı Bakım & Aksesuar | Ölçü | Net İçerik (isteğe bağlı: `hacim_ml` ml · `net_agirlik_g` g · `paket_adedi`), Uyumlu Malzeme (Deri · Süet · Tekstil · Tümü) |
| `AKS-CANTA` | Aksesuar > Çanta; Anne Bebek Çantası | — | Cinsiyet, Yaş Grubu, Kapama (Fermuarlı · Mıknatıslı · Çıtçıtlı · Kapaklı · Açık), Askı Tipi (El · Omuz · Çapraz · Sırt · Ayarlanabilir), Laptop Bölmesi (`laptop_bolmesi_inc`; inç; boş = yok; öneri 13 · 14 · 15,6 · 17), Hacim (`hacim_ml`; **L** gösterilir). Materyal: Deri · Suni Deri · Kanvas · Kumaş · Naylon · Süet · Hasır · Kadife. En/Boy/Yükseklik görünür. |
| `AKS-CUZDAN` | Aksesuar > Cüzdan & Kartlık | — | Cinsiyet, Kart Bölmesi (`kart_bolmesi`), Bozuk Para Bölmesi (Var/Yok), RFID Koruma (Var/Yok). Materyal çanta listesi. |
| `AKS-TAKI` | Aksesuar > Takı | Ölçü (yüzük no., uzunluk) | Cinsiyet, Ayar (8 · 14 · 18 · 22 Ayar · 925 Gümüş · Yok), Taş (Taşsız · Zirkon · Pırlanta · Doğal Taş · İnci · Kristal), Uzunluk (`uzunluk_cm`; cm; bütün varyantlarda aynıysa). Materyal: Altın · Gümüş · Çelik · Pirinç · Bakır · Titanyum · Doğal Taş · İnci · Boncuk · Ahşap · Deri. |
| `AKS-SAAT` | Aksesuar > Saat & Gözlük > Kol Saati | — | Cinsiyet, Mekanizma (Quartz · Otomatik · Mekanik), Kasa Çapı (`kasa_capi_mm`; mm), Kordon (Çelik · Deri · Silikon · Hasır · Kumaş), Su Geçirmezlik (`su_gecirmezlik_atm`; ATM; boş = yok; öneri 3 · 5 · 10 · 20), Garanti Süresi (`garanti_ay`) |
| `AKS-GOZLUK` | Aksesuar > Saat & Gözlük > Güneş Gözlüğü | — | Cinsiyet, Çerçeve Şekli (Aviator · Kare · Dikdörtgen · Yuvarlak · Oval · Cat Eye · Kelebek), Cam Özelliği (Polarize · UV400 · Aynalı · Degrade · Fotokromik). Materyal: Asetat · Metal · Titanyum · Plastik · Ahşap. |
| `AKS-GIYIM` | Aksesuar > Şapka, Bere & Eldiven; Atkı, Şal & Eşarp; Kravat & Papyon | Beden | Cinsiyet\*, Yaş Grubu\*, Sezon, Desen, Tesettür (şal/eşarpta). Materyal giyim listesi. |
| `AKS-KEMER` | Aksesuar > Kemer & Kravat > Kemer | Ölçü (ör. 95 cm) | Cinsiyet, Kemer Genişliği (`genislik_cm`; cm). Materyal çanta listesi. |
| `BEB-EKIPMAN` | Anne & Çocuk > Taşıma & Güvenlik; Mama Sandalyesi | — | Yaş/Kilo Aralığı (metin, ör. "0-4 Yaş / 0-22 kg"), Taşıma Kapasitesi (`tasima_kapasitesi_kg`; kg), Katlanabilir (Evet/Hayır). En/Boy/Yükseklik görünür. |
| `BEB-OTO` | Anne & Çocuk > Taşıma & Güvenlik > Oto Koltuğu | — | Grup (Grup 0+ · 0+/1 · 1/2/3 · 2/3 · i-Size), Kilo Aralığı (metin), Isofix (Var/Yok), Yön (İleri · Geri · Çift Yönlü) |
| `BEB-BESLENME` | Anne & Çocuk > Beslenme & Emzirme (Mama Sandalyesi hariç) | Hacim | Minimum Yaş (`minimum_yas_ay`; öneri 0 · 3 · 6 · 9 · 12 · 18), Hacim (`hacim_ml`; ml), BPA İçermez (Evet/Hayır). Materyal: Cam · Polipropilen · Silikon · Tritan · Paslanmaz Çelik · Bambu. |
| `BEB-BAKIM` | Anne & Çocuk > Bebek Bakım (Bebek Bezi hariç); Göğüs Kremi | Net İçerik | Net İçerik\* (`hacim_ml` ml · `net_agirlik_g` g · `paket_adedi`; ıslak mendil paket adedi), Minimum Yaş (`minimum_yas_ay`). Materyal gizli. |
| `BEB-BEZ` | Anne & Çocuk > Bebek Bakım > Bebek Bezi | Bez Numarası (1–7) | Paket Adedi\* (`paket_adedi`; varyantlıysa her varyantta), Kilo Aralığı (metin). Materyal gizli. |
| `BEB-ODA` | Anne & Çocuk > Bebek Odası | Ölçü | Yaş Aralığı (metin), Kurulum Gerekir (Evet/Hayır). Materyal: Ahşap · MDF · Metal · Pamuk · Müslin · Polyester. En/Boy/Yükseklik görünür. |
| `OYUNCAK` | Anne & Çocuk > Oyuncak | — | Minimum Yaş\* (`minimum_yas_ay`; "3+ Yaş" etiketiyle gösterilir; öneri 0 · 6 · 12 · 18 · 24 · 36 · 48 · 60 · 72 · 96 · 120 · 144 · 168), Cinsiyet, Enerji (Pilsiz · Pilli · Şarjlı), Parça Sayısı (`parca_sayisi`). Materyal: Ahşap · Plastik · Peluş · Metal · Kumaş · Karton. |
| `KOZ-MAKYAJ` | Kozmetik & Kişisel Bakım > Makyaj (fırça ve set hariç) | Ton | Net İçerik\* (`hacim_ml` ml · `net_agirlik_g` g; bütün tonlar için ortak), Form (Sıvı · Krem · Pudra · Stick · Jel · Kalem), Bitiş (Mat · Saten · Parlak · Işıltılı), Cilt Tipi (Tüm · Kuru · Yağlı · Karma · Hassas · Normal), Cinsiyet. Materyal ve En/Boy/Yükseklik gizli. |
| `KOZ-BAKIM` | Cilt Bakımı; Saç Bakımı; El, Ayak & Tırnak Bakımı (araç ve setler hariç) | Net İçerik | Net İçerik\* (`hacim_ml` ml · `net_agirlik_g` g · `paket_adedi`; kâğıt maske paket adedi), Cilt Tipi, Saç Tipi (Tüm · Kuru · Yağlı · Normal · Boyalı · Kıvırcık · İnce Telli), Etki (Nemlendirici · Arındırıcı · Yaşlanma Karşıtı · Aydınlatıcı · Akne Karşıtı · Onarıcı · Besleyici · Hacim Verici · Dökülme Karşıtı), SPF (`spf`; güneş ürünlerinde), Cinsiyet. Materyal ve Renk gizli. |
| `KOZ-PARFUM` | Parfüm & Deodorant > Parfüm, Kolonya | Hacim | Cinsiyet\*, Hacim\* (`hacim_ml`; ml; varyantlıysa her varyantta), Konsantrasyon (Extrait · EDP · EDT · EDC · Body Mist), Koku Ailesi (Çiçeksi · Odunsu · Oryantal · Fresh · Meyveli · Baharatlı · Aromatik · Gurme) |
| `KOZ-KISISEL` | Banyo & Duş; Ağız & Diş; Tıraş & Erkek Bakımı; Epilasyon & Ağda; Kadın Hijyen; Cinsel Sağlık; Deodorant (araçlar hariç) | Net İçerik | Net İçerik\* (`hacim_ml` ml · `net_agirlik_g` g · `paket_adedi`; ped, tampon, prezervatif paket adedi), Cinsiyet |
| `KOZ-ARAC` | Makyaj Fırçası & Aksesuarı; Saç Fırçası & Tarak; Manikür & Pedikür; Diş Fırçası; Diş İpi; Tıraş Bıçağı | — | Paket Adedi (`paket_adedi`), Cinsiyet. Materyal görünür: Sentetik Kıl · Doğal Kıl · Ahşap · Bambu · Plastik · Paslanmaz Çelik. Net içerik yok. |
| `KOZ-SET` | Makyaj Seti; Cilt Bakım Seti | — | Set İçeriği\* (metin), Parça Sayısı (`parca_sayisi`), Cilt Tipi, Cinsiyet. Net içerik yok. |
| `ELK-BILGISAYAR` | Laptop, Masaüstü Bilgisayar | — | İşlemci (Intel Core i3/i5/i7/i9 · Core Ultra · AMD Ryzen 3/5/7/9 · Apple M serisi · Diğer), RAM (`ram_gb`; öneri 4 · 8 · 16 · 32 · 64 · 96 · 128), RAM Tipi (DDR4 · DDR5 · LPDDR5 · Birleşik), Depolama Tipi (SSD · HDD · SSD+HDD · eMMC), Depolama (`depolama_gb`; 1 TB = 1000 GB; öneri 128 · 256 · 512 · 1000 · 2000 · 4000), Ekran Kartı (Dahili · Harici) + Model (metin), Ekran Boyutu (`ekran_boyutu_inc`), Çözünürlük (HD · Full HD · QHD · 4K), İşletim Sistemi (Windows · macOS · Linux · FreeDOS · ChromeOS), Garanti\* (`garanti_ay`) |
| `ELK-TABLET` | Tablet | — | Depolama (`depolama_gb`), RAM (`ram_gb`), Ekran Boyutu (`ekran_boyutu_inc`), İşletim Sistemi (iPadOS · Android · Windows), Bağlantı (Wi-Fi · Wi-Fi + Hücresel), Garanti\* |
| `ELK-MONITOR` | Monitör | — | Ekran Boyutu (`ekran_boyutu_inc`), Çözünürlük, Yenileme Hızı (`yenileme_hizi_hz`; öneri 60 · 75 · 100 · 120 · 144 · 165 · 240 · 360), Panel (IPS · VA · TN · OLED), Garanti\* |
| `ELK-CEVRE` | Klavye & Mouse, Veri Depolama, Ağ & Modem | — | Bağlantı (Kablolu · Kablosuz · Bluetooth), Uyumlu Cihaz (metin), Depolama (`depolama_gb`; veri depolamada), Garanti\* |
| `ELK-AKS` | Bilgisayar Aksesuarları, Oyuncu Ekipmanları, Kamera Aksesuarları | — | Uyumlu Cihaz (metin), Bağlantı (Kablolu · Kablosuz · Bluetooth · Yok), Garanti (isteğe bağlı). Materyal görünür. Bu gruplarda elektronik olmayan ürünler de bulunduğu için garanti zorunlu değildir. |
| `ELK-TEL-AKS` | Elektronik > Telefon Aksesuarları | Uyumlu Model | Uyumlu Marka (metin), Giriş (USB-C · Lightning · Micro USB · Kablosuz/MagSafe), Pil Kapasitesi (`pil_kapasitesi_mah`; powerbankte), Güç (`guc_w`), Garanti (isteğe bağlı) |
| `ELK-SES` | Elektronik > Ses & Kulaklık | — | Bağlantı (Bluetooth · Kablolu · Kablosuz), Kulaklık Tipi (Kulak İçi · Kulak Üstü · Kulak Çevresi), Gürültü Engelleme (Var/Yok), Pil Ömrü (`pil_omru_saat`; saat), Suya Dayanıklılık (Yok · IPX4 · IPX5 · IPX7 · IPX8), Güç (`guc_w`), Garanti\* |
| `ELK-GIYILEBILIR` | Elektronik > Giyilebilir Teknoloji | — | Uyumlu İşletim Sistemi (iOS · Android · İkisi), Kasa Boyutu (`kasa_capi_mm`; mm), Pil Ömrü (`pil_omru_saat`; **gün** gösterilir), Suya Dayanıklılık (Yok · IP67 · IP68 · 5 ATM), Garanti\* |
| `ELK-KAMERA` | Fotoğraf Makinesi, Aksiyon Kamerası, Video Kamera, Drone | — | Çözünürlük (`cozunurluk_mp`), Video (Full HD · 4K · 5K · 8K), Görüntü Sabitleme (Var/Yok), Suya Dayanıklılık, Uçuş Süresi (`ucus_suresi_dk`; drone), Garanti\* |
| `ELK-AKILLI-EV` | Elektronik > Akıllı Ev & Güvenlik | — | Bağlantı (Wi-Fi · Bluetooth · Zigbee · Matter), Uyumlu Asistan (Google · Alexa · Apple Home · Yok), Garanti\* |
| `ELK-BAKIM-ALETI` | Elektronik > Kişisel Bakım Aletleri | — | Güç (`guc_w`), Kullanım (Kablolu · Şarjlı · İkisi), Cinsiyet, Garanti\* |
| `ELK-EV-ALETI` | Elektronik > Elektrikli Ev & Mutfak Aletleri; Bebek Buhar Makinesi | — | Güç (`guc_w`), Kapasite (`hacim_ml`; **L** gösterilir), Garanti\* |
| `SPR-EKIPMAN` | Spor & Outdoor > Fitness & Kondisyon; Takım & Raket Sporları; Doğa Sporları | Ölçü (ör. 5 kg, 4 mm) | Kullanım (Spor · Outdoor), Spor Branşı (Fitness · Yoga & Pilates · Koşu · Futbol · Basketbol · Voleybol · Tenis · Masa Tenisi · Badminton · Yüzme & Dalış · Dağcılık · Kayak & Snowboard · Diğer) |
| `SPR-KAMP` | Spor & Outdoor > Kamp & Outdoor | Ölçü | Kullanım, Sezon, Kişi Kapasitesi (`kisi_sayisi`; çadırda), Su Geçirmez (Evet/Hayır), Konfor Sıcaklığı (`konfor_sicakligi_c`; uyku tulumunda), Hacim (`hacim_ml`; **L** gösterilir) |
| `SPR-BISIKLET` | Spor & Outdoor > Bisiklet & Scooter | Ölçü (kadro) | Kullanım, Yaş Grubu (Yetişkin · Çocuk), Teker Boyutu (`teker_boyutu_inc`), Vites Sayısı (`vites_sayisi`), Elektrikli (Evet/Hayır), Taşıma Kapasitesi (`tasima_kapasitesi_kg`), Menzil (`menzil_km`), Garanti (isteğe bağlı) |
| `EV-MOBILYA` | Ev > Mobilya; Ofis > Mobilya | Ölçü | Mevcut Renk/Materyal/ölçü/ağırlık + Stil (Modern · Klasik · Rustik · İskandinav · Endüstriyel · Bohem), Kurulum Gerekir (Evet/Hayır) |
| `EV-AYDINLATMA` | Ev > Aydınlatma; Ofis > Aydınlatma | Ölçü | Duy Tipi (E27 · E14 · GU10 · G9 · Entegre LED), Ampul Dahil (Evet/Hayır), Işık Rengi (Sıcak Beyaz · Gün Işığı · Soğuk Beyaz · RGB), Güç (`guc_w`), Stil |
| `EV-TEKSTIL` | Ev > Ev Tekstili | Ölçü (ör. Çift Kişilik, 160x230) | Desen, Makinede Yıkanabilir (Evet/Hayır). Materyal: Pamuk · Keten · Yün · Polyester · Bambu · Müslin · Kadife · Akrilik |
| `EV-MUTFAK` | Ev > Mutfak & Sofra | Ölçü | Hacim (`hacim_ml`; ml; bütün varyantlarda aynıysa), Parça Sayısı (`parca_sayisi`), Kişi Sayısı (`kisi_sayisi`), Bulaşık Makinesinde Yıkanabilir (Evet/Hayır), Mikrodalga Uyumlu (Evet/Hayır) |
| `EV-DEKOR` | Ev > Ev Dekorasyon; Ev > Ev Aksesuarları; Ofis > Aksesuar | Ölçü | Stil |
| `EV-BAKIM` | Ev > Ev Bakımı | Ölçü | Net İçerik (isteğe bağlı: `hacim_ml` ml · `net_agirlik_g` g · `paket_adedi`), Koku (metin) |

### 4.4 Sayısal alan anahtarları

Her sayısal alan tek bir anahtara bağlıdır. Anahtarın ölçüm türü ve kanonik birimi, alan ürünlerde kullanıldıktan sonra değiştirilemez. Şablonlar yalnız gösterim birimini seçer. Farklı ölçüm türleri ayrı anahtardır; filtrede ayrı başlık olarak görünür.

| Anahtar | Alan | Ölçüm türü | Kanonik birim | İzinli giriş birimleri | Gösterim (şablon) |
|---|---|---|---|---|---|
| `hacim_ml` | Hacim / Kapasite | Hacim | ml | ml, L (×1000) | ml: kozmetik, parfüm, beslenme, bebek bakım, mutfak, bakım ürünleri · L: çanta, kamp, elektrikli ev aletleri |
| `net_agirlik_g` | Net Ağırlık | Ağırlık | g | g, kg (×1000) | g |
| `paket_adedi` | Paket Adedi | Sayı | adet | adet | adet |
| `parca_sayisi` | Parça Sayısı | Sayı | adet | adet | adet |
| `kisi_sayisi` | Kişi Sayısı / Kişi Kapasitesi | Sayı | kişi | kişi | kişi |
| `kart_bolmesi` | Kart Bölmesi | Sayı | adet | adet | adet |
| `vites_sayisi` | Vites Sayısı | Sayı | adet | adet | adet |
| `uzunluk_cm` | Uzunluk | Uzunluk | cm | cm, mm (÷10) | cm |
| `genislik_cm` | Kemer Genişliği | Uzunluk | cm | cm, mm (÷10) | cm |
| `topuk_yuksekligi_cm` | Topuk Yüksekliği | Uzunluk | cm | cm, mm (÷10) | cm |
| `kasa_capi_mm` | Kasa Çapı / Kasa Boyutu | Uzunluk | mm | mm | mm |
| `ekran_boyutu_inc` | Ekran Boyutu | Uzunluk | inç | inç | inç |
| `laptop_bolmesi_inc` | Laptop Bölmesi | Uzunluk | inç | inç | inç |
| `teker_boyutu_inc` | Teker Boyutu | Uzunluk | inç | inç | inç |
| `menzil_km` | Menzil | Uzunluk | km | km | km |
| `ram_gb` | RAM | Bellek | GB | GB, TB (×1000) | GB |
| `depolama_gb` | Depolama | Bellek | GB | GB, TB (×1000) | GB; 1000 ve üzeri TB olarak |
| `pil_kapasitesi_mah` | Pil Kapasitesi | Elektrik yükü | mAh | mAh | mAh |
| `guc_w` | Güç | Güç | W | W, kW (×1000) | W |
| `yenileme_hizi_hz` | Yenileme Hızı | Frekans | Hz | Hz | Hz |
| `pil_omru_saat` | Pil Ömrü | Süre | saat | saat, gün (×24) | saat: ses · gün: giyilebilir |
| `ucus_suresi_dk` | Uçuş Süresi | Süre | dk | dk | dk |
| `garanti_ay` | Garanti Süresi | Süre | ay | ay, yıl (×12) | ay ya da yıl |
| `minimum_yas_ay` | Minimum Yaş | Süre | ay | ay, yıl (×12) | "6+ Ay", "3+ Yaş" |
| `tasima_kapasitesi_kg` | Taşıma Kapasitesi | Ağırlık | kg | kg | kg |
| `su_gecirmezlik_atm` | Su Geçirmezlik | Basınç | ATM | ATM | ATM |
| `konfor_sicakligi_c` | Konfor Sıcaklığı | Sıcaklık | °C | °C | °C |
| `cozunurluk_mp` | Çözünürlük | Piksel | MP | MP | MP |
| `spf` | SPF | Endeks | — | — | — |

Ortak "Ağırlık" alanı (`Product.weight`, kg) gönderim ağırlığıdır ve bu tabloda değildir; içerik ağırlığı `net_agirlik_g` anahtarındadır.

---

## 5. Kategori ağacı

### 5.1 Tasarımcı yükleme ağacı

Biçim: **Alt-1 dal** · `varsayılan şablon` — yapraklar. Yaprak yanında farklı bir şablon kodu varsa o yaprak o şablonu kullanır. Ev ve Ofis'te `›` işareti bir ara dalın altındaki yaprakları gösterir.

İşaretler:
- `⁺` Excel'de yoktu, eklendi. Kozmetik ve Elektronik'te kaynak Hepsiburada menüsü; diğerlerinde tutarlılık önerisi (ör. Tesettür filtresi için Tunik ve Pardösü & Ferace).
- `°` Excel'deki genel bir kalemin ("Cilt Bakım", "Saç Bakımı", "Makyaj", "Ağız Bakım", "Cinsel Sağlık") alt tiplere ayrılmış hali.
- İşaretsiz yapraklar Excel'deki bir kalemin doğrudan karşılığıdır.

#### Ev · `/kategori/ev` — mevcut, değişmiyor

- **Mobilya** · `EV-MOBILYA` — Koltuk & Kanepe, Berjer, Sandalye & Tabure, Dresuar & Konsol › Dresuar, Konsol, Vitrin & Büfe, Dolap, Bank, Yatak & Karyola, Şifonyer & Komodin, Puf, Sehpa Modelleri › Orta Sehpa, Yan Sehpa, Zigon Sehpa, Masa, Askılık, Bahçe Mobilyaları › Bahçe Oturma Grubu, Bahçe Masa & Sandalye, Dış Mekan Sehpa, Kitaplık
- **Aydınlatma** · `EV-AYDINLATMA` — Yer Lambası, Tavan & Sarkıt › Tavan Aydınlatma, Sarkıt Aydınlatma, Masa Lambaları, Dekoratif, Duvar, Abajur
- **Ev Bakımı** · `EV-BAKIM` — Oda Kokuları, Uçucu Yağ & Buhurdanlıklar, Tütsü & Tütsülükler, Temizlik Ürünleri
- **Ev Aksesuarları** · `EV-DEKOR` — Saklama & Düzenleme, Duvar Aksesuarları, Banyo Aksesuarları, Duvar Askıları, Tavan Aksesuarları
- **Mutfak & Sofra** · `EV-MUTFAK` — Bardak & Fincan & Kupa, Sunum Aksesuarları, Tabak & Kase › Tabak, Kase, Sofra Seti, Pişirme & Hazırlama, Saklama & Düzenleme, Sofra Tekstili, Çatal & Kaşık & Bıçak
- **Ev Dekorasyon** · `EV-DEKOR` — Ayna, Çerçeve, Vazo, Saat, Dekoratif Obje, Saksı & Bitki, Kulplar, Mum & Mumluk › Mum, Mumluk, Şömine & Barbekü
- **Ev Tekstili** · `EV-TEKSTIL` — Yastık, Halı & Kilim, Paspas, Havlu & Peştemal, Bornoz, Yatak & Koltuk Örtüleri, Battaniye, Nevresim

#### Ofis · `/kategori/ofis` — mevcut, değişmiyor

- **Mobilya** · `EV-MOBILYA` — Sehpa, Koltuk & Berjer, Sandalye, Tabure & Puf, Depolama, Çalışma Masası
- **Aksesuar** · `EV-DEKOR` — Masaüstü Aksesuarları, Düzenleme, Saat
- **Aydınlatma** · `EV-AYDINLATMA` — Masa Lambaları, Yer Aydınlatmaları, Tavan Aydınlatmaları

#### Giyim · `/kategori/giyim`

- **Üst Giyim** · `GIY-UST` — Tişört, Gömlek, Bluz, Tunik⁺, Sweatshirt, Hırka, Kazak, Polar, Yelek, Forma, Body & Zıbın
- **Alt Giyim** · `GIY-ALT` — Pantolon, Kot Pantolon, Şort, Etek, Tayt, Eşofman Altı
- **Elbise & Tulum** · `GIY-ELB` — Elbise, Abiye Elbise, Tulum
- **Dış Giyim** · `GIY-DIS` — Mont, Kaban, Palto, Trençkot, Pardösü & Ferace⁺, Yağmurluk & Rüzgarlık, Ceket, Blazer Ceket, Kot Ceket, Deri Ceket & Mont
- **Takım & Set** · `GIY-TAK` — Takım Elbise, Eşofman Takımı, Alt Üst Takım, Hastane Çıkışı Seti
- **İç Giyim & Ev Giyimi** · `GIY-IC` — Sütyen, Spor Sütyeni, Bralet, Büstiyer, Külot, Boxer, İç Çamaşırı Takımı, Atlet & Body, İçlik, Korse, Kombinezon, Jartiyer, Fantezi Giyim, Çorap, Pijama Takımı, Gecelik
- **Mayo & Plaj** · `GIY-MAYO` — Mayo⁺, Bikini⁺, Deniz Şortu⁺, Plaj Elbisesi & Pareo⁺

#### Ayakkabı · `/kategori/ayakkabi`

- **Spor Ayakkabı** · `AYK` — Antrenman Ayakkabısı, Koşu Ayakkabısı, Yürüyüş Ayakkabısı, Basketbol Ayakkabısı⁺, Tenis Ayakkabısı⁺, Krampon, Outdoor & Trekking Ayakkabısı
- **Sneaker & Günlük** · `AYK` — Sneaker, Günlük Ayakkabı, Loafer, Babet
- **Klasik & Topuklu** · `AYK` — Klasik Ayakkabı, Topuklu Ayakkabı
- **Bot & Çizme** · `AYK` — Bot, Çizme, Kar Botu, Outdoor Bot
- **Sandalet & Terlik** · `AYK` — Sandalet, Terlik⁺, Ev Terliği
- **Bebek Ayakkabısı** · `AYK` — Bebek Patiği, İlk Adım Ayakkabısı
- **Ayakkabı Bakım & Aksesuar** · `AYK-BAKIM` — Ayakkabı Bakım Ürünleri⁺, Bağcık⁺, Tabanlık⁺

#### Aksesuar · `/kategori/taki-aksesuar`

- **Çanta** · `AKS-CANTA` — Omuz Çantası, El Çantası, Çapraz Çanta, Sırt Çantası, Bel Çantası, Postacı Çantası, Tote Çanta, Bez & Kanvas Çanta, Abiye Çanta, Portföy, Laptop Çantası, Evrak Çantası, Okul Çantası, Beslenme Çantası, Spor Çantası, Makyaj Çantası, Valiz & Bavul
- **Cüzdan & Kartlık** · `AKS-CUZDAN` — Cüzdan, Kartlık
- **Takı** · `AKS-TAKI` — Kolye, Küpe, Bileklik, Yüzük, Broş, Takı Seti
- **Saat & Gözlük** · `AKS-SAAT` — Kol Saati, Güneş Gözlüğü `AKS-GOZLUK`
- **Şapka, Bere & Eldiven** · `AKS-GIYIM` — Şapka, Bere, Eldiven, Boyunluk
- **Atkı, Şal & Eşarp** · `AKS-GIYIM` — Atkı, Şal, Eşarp⁺
- **Kemer & Kravat** · `AKS-GIYIM` — Kemer `AKS-KEMER`, Kravat & Papyon

#### Anne & Çocuk · `/kategori/anne-cocuk`

- **Taşıma & Güvenlik** · `BEB-EKIPMAN` — Bebek Arabası & Puset, Baston Puset, Ana Kucağı, Portbebe & Kanguru, Yürüteç, Park Yatak, Bebek Salıncağı, Oto Koltuğu `BEB-OTO`, Anne Bebek Çantası `AKS-CANTA`
- **Beslenme & Emzirme** · `BEB-BESLENME` — Biberon & Emzik, Biberon Seti, Biberon Temizleyici, Sterilizatör, Buharlı Pişirici, Mama Sandalyesi `BEB-EKIPMAN`, Mama Önlüğü, Alıştırma Bardağı, Yemek Seti, Termal Çanta, Göğüs Pompası, Emzirme Önlüğü, Emzirme Minderi, Göğüs Pedi, Göğüs Kremi `BEB-BAKIM`
- **Bebek Bakım** · `BEB-BAKIM` — Bebek Bezi `BEB-BEZ`, Islak Mendil, Bebek Şampuanı, Bebek Sabunu, Bebek Yağı, Bebek Kremi & Losyonu, Bebek Deterjanı, Bebek Buhar Makinesi `ELK-EV-ALETI`
- **Bebek Odası** · `BEB-ODA` — Beşik, Bebek Yatağı, Bebek Nevresimi, Bebek Battaniyesi, Cibinlik, Oyuncak Sepeti, Oyuncak Dolabı, Bebek Odası Mobilyası, Oyun Matı, Oyun Parkı
- **Oyuncak** · `OYUNCAK` — Eğitici Oyuncak, Bebek & Okul Öncesi Oyuncak, Oyuncak Araba, Oyuncak Bebek, Kumandalı Oyuncak, Robot Oyuncak, Çocuk Çizim Tableti

#### Kozmetik & Kişisel Bakım · `/kategori/kozmetik-kisisel-bakim`

- **Makyaj** · `KOZ-MAKYAJ` — Fondöten, Kapatıcı, Pudra, BB & CC Krem, Allık & Bronzer°, Aydınlatıcı & Highlighter, Makyaj Bazı & Sabitleyici°, Göz Farı, Maskara, Eyeliner & Göz Kalemi, Kaş Makyajı, Ruj, Dudak Kalemi & Parlatıcı°, Oje & Tırnak Makyajı°, Makyaj Temizleyici°, Makyaj Fırçası & Aksesuarı° `KOZ-ARAC`, Makyaj Seti° `KOZ-SET`
- **Cilt Bakımı** · `KOZ-BAKIM` — Yüz Nemlendirici, Yüz Temizleyici & Tonik°, Serum & Yüz Yağı°, Yüz Maskesi & Peeling°, Göz Bakımı°, Dudak Bakımı, Vücut Bakımı, Güneş Ürünleri°, Cilt Bakım Seti° `KOZ-SET`
- **Saç Bakımı** · `KOZ-BAKIM` — Şampuan°, Saç Kremi°, Saç Maskesi & Bakım Yağı°, Saç Şekillendirici°, Saç Boyası°, Kuru Şampuan°, Saç Fırçası & Tarak° `KOZ-ARAC`
- **Parfüm & Deodorant** · `KOZ-PARFUM` — Parfüm, Kolonya⁺, Deodorant `KOZ-KISISEL`
- **Banyo & Duş** · `KOZ-KISISEL` — Duş Jeli & Kremi, Katı & Sıvı Sabun⁺
- **El, Ayak & Tırnak Bakımı** · `KOZ-BAKIM` — El Kremi, Ayak Bakımı⁺, Manikür & Pedikür `KOZ-ARAC`
- **Ağız & Diş Bakımı** · `KOZ-KISISEL` — Diş Macunu°, Diş Fırçası° `KOZ-ARAC`, Ağız Gargarası°, Diş İpi° `KOZ-ARAC`
- **Tıraş & Erkek Bakımı** · `KOZ-KISISEL` — Tıraş Bıçağı `KOZ-ARAC`, Tıraş Köpüğü & Jeli⁺, Tıraş Sonrası⁺, Sakal Bakımı⁺
- **Epilasyon & Ağda** · `KOZ-KISISEL` — Ağda⁺, Tüy Dökücü Krem⁺
- **Kadın Hijyen** · `KOZ-KISISEL` — Hijyenik Ped, Günlük Ped⁺, Tampon⁺
- **Cinsel Sağlık** · `KOZ-KISISEL` — Prezervatif°, Kayganlaştırıcı°

#### Elektronik · `/kategori/elektronik`

- **Bilgisayar & Tablet** · `ELK-CEVRE` — Laptop⁺ `ELK-BILGISAYAR`, Masaüstü Bilgisayar⁺ `ELK-BILGISAYAR`, Tablet⁺ `ELK-TABLET`, Monitör⁺ `ELK-MONITOR`, Klavye & Mouse⁺, Veri Depolama⁺, Ağ & Modem⁺, Bilgisayar Aksesuarları⁺ `ELK-AKS`, Oyuncu Ekipmanları⁺ `ELK-AKS`
- **Telefon Aksesuarları** · `ELK-TEL-AKS` — Telefon Kılıfı⁺, Ekran Koruyucu⁺, Şarj Cihazı⁺, Şarj Kablosu⁺, Powerbank⁺, Telefon Tutucu & Stand⁺
- **Ses & Kulaklık** · `ELK-SES` — Kulaklık⁺, Bluetooth Hoparlör⁺, Müzik Sistemi & Pikap⁺
- **Giyilebilir Teknoloji** · `ELK-GIYILEBILIR` — Akıllı Saat⁺, Akıllı Bileklik⁺
- **Foto & Kamera** · `ELK-KAMERA` — Fotoğraf Makinesi⁺, Aksiyon Kamerası, Video Kamera⁺, Drone⁺, Kamera Aksesuarları⁺ `ELK-AKS`
- **Akıllı Ev & Güvenlik** · `ELK-AKILLI-EV` — Akıllı Ev Ürünleri⁺, Güvenlik Kamerası⁺
- **Kişisel Bakım Aletleri** · `ELK-BAKIM-ALETI` — Saç Kurutma Makinesi⁺, Saç Şekillendirme Cihazı⁺, Tıraş & Sakal Makinesi⁺, Epilatör & IPL⁺, Masaj Aleti⁺
- **Elektrikli Ev & Mutfak Aletleri** · `ELK-EV-ALETI` — Kahve Makinesi⁺, Çay Makinesi⁺, Su Isıtıcı (Kettle)⁺, Blender & Mutfak Robotu⁺, Tost Makinesi⁺, Süpürge⁺, Ütü⁺, Hava Temizleyici & Nem Alma⁺

#### Spor & Outdoor · `/kategori/spor-outdoor`

- **Fitness & Kondisyon** · `SPR-EKIPMAN` — Yoga & Pilates Matı, Ağırlık & Dambıl, Direnç Bandı, Spor Aksesuarları
- **Takım & Raket Sporları** · `SPR-EKIPMAN` — Top, Raket, Koruyucu Ekipman
- **Kamp & Outdoor** · `SPR-KAMP` — Çadır, Uyku Tulumu, Kamp Mobilyası, Kamp Mutfağı & Termos, Fener & Kamp Aydınlatması, Outdoor Ekipmanları
- **Doğa Sporları** · `SPR-EKIPMAN` — Dağcılık & Tırmanış, Kayak & Kar Sporları, Dalış & Su Sporları
- **Bisiklet & Scooter** · `SPR-BISIKLET` — Bisiklet, Scooter, Paten & Kaykay⁺, Bisiklet & Scooter Aksesuarları⁺

### 5.2 Mağaza ağacı

Mağaza ağacı tasarımcı ağacıyla **aynıdır**; ayrıca verilmemiştir. Farklar:
- Ürünü olmayan dal, ana kategori dahil, mağazada ve menüde görünmez (mevcut kural).
- Üst menü sırası: Ev · Ofis · Giyim · Ayakkabı · Aksesuar · Anne & Çocuk · Kozmetik & Kişisel Bakım · Elektronik · Spor & Outdoor · İndirim.
- Açılır menüde alt-1 başlıklar ve yapraklar görünür. Ev'in açılır menüsünde Mobilya, Aydınlatma, Ev Bakımı, Ev Aksesuarları, Mutfak & Sofra, Ev Dekorasyon ve Ev Tekstili bulunur.
- Kadın/Erkek ayrımı ve Büyük Beden, Tesettür, Kullanım gibi özellikler mağazada dal değil, filtredir (Aşama 2).
- Sanal koleksiyon sayfaları (`/kategori/mobilya`, `/kategori/aydinlatma`, `/kategori/aksesuar`) adresleriyle kalır ama menüde görünmez.

### 5.3 Hepsiburada'dan alınmayan gruplar

Kozmetik ve Elektronik için Hepsiburada'nın menüsü örnek alındı. Tasarımcı ürünü olması beklenmeyen ya da ayrı yükümlülük getiren şu gruplar eklenmedi; istenirse admin sonradan açabilir:
- **Elektronik:** Cep Telefonu (IMEI kaydı gerektirir), Beyaz Eşya, Klima ve Isıtıcılar, Televizyon / uydu / DVD, Oyun konsolları, Yazıcı ve projeksiyon, Yazılım.
- **Kozmetik & Kişisel Bakım:** Besin takviyeleri (gıda kararı), Medikal ürünler.

### 5.4 Onaya sunulan noktalar

1. `⁺` ile işaretli 64 yaprak Excel'de yoktu (Hepsiburada'dan ya da tutarlılık için eklendi). Çıkarılmasını istediğin olursa liste daralır.
2. Saç kurutma makinesi, tıraş makinesi, epilatör gibi **kişisel bakım aletleri** Hepsiburada'daki gibi Elektronik altında duruyor, Kozmetik'te değil.
3. **Ana sayfadaki "Aksesuar" kartı** bugün ev+ofis aksesuarlarına gidiyor. Menüdeki yeni Aksesuar (takı, çanta) ile karışmaması için kartın adının "Ev Aksesuarları" yapılması önerilir.
4. **Ev ve Ofis ağacı** depodaki seed dosyasından alındı. Canlı veritabanında admin sonradan dal eklediyse, uygulama öncesi canlı ağaçla karşılaştırılmalı. Bu plan Ev/Ofis'i değiştirmiyor.
5. "Fantezi Giyim", "Jartiyer" ve "Cinsel Sağlık" Excel'deki gibi alındı.

---

## Ek A — Excel dönüşüm tablosu (310 satır)

Her satır Excel'deki bir kalemin yeni yerini gösterir. "Ürün özelliği" sütunu, bu kalemdeki ürün yüklenirken seçilecek değeri gösterir (ör. Kadın kökünden gelen ürün için "Cinsiyet: Kadın").

| # | Excel'deki yer | Yeni yer | Ürün özelliği / not |
|---|---|---|---|
| 1 | Kadın > Giyim > Elbise | Giyim > Elbise & Tulum > Elbise | Cinsiyet: Kadın |
| 2 | Kadın > Giyim > Tişört | Giyim > Üst Giyim > Tişört | Cinsiyet: Kadın |
| 3 | Kadın > Giyim > Gömlek | Giyim > Üst Giyim > Gömlek | Cinsiyet: Kadın |
| 4 | Kadın > Giyim > Kot Pantolon | Giyim > Alt Giyim > Kot Pantolon | Cinsiyet: Kadın |
| 5 | Kadın > Giyim > Kot Ceket | Giyim > Dış Giyim > Kot Ceket | Cinsiyet: Kadın |
| 6 | Kadın > Giyim > Pantolon | Giyim > Alt Giyim > Pantolon | Cinsiyet: Kadın |
| 7 | Kadın > Giyim > Mont | Giyim > Dış Giyim > Mont | Cinsiyet: Kadın |
| 8 | Kadın > Giyim > Bluz | Giyim > Üst Giyim > Bluz | Cinsiyet: Kadın |
| 9 | Kadın > Giyim > Ceket | Giyim > Dış Giyim > Ceket | Cinsiyet: Kadın |
| 10 | Kadın > Giyim > Etek | Giyim > Alt Giyim > Etek | Cinsiyet: Kadın |
| 11 | Kadın > Giyim > Kazak | Giyim > Üst Giyim > Kazak | Cinsiyet: Kadın |
| 12 | Kadın > Giyim > Tesettür | — (dal değil, filtre) → ilgili ürün tipine yüklenir (Tunik, Elbise, Pardösü & Ferace, Eşarp…) | Tesettür: Evet · Cinsiyet: Kadın |
| 13 | Kadın > Giyim > Büyük Beden | — (dal değil, filtre) → ilgili ürün tipine yüklenir (Sweatshirt, Pantolon…) | Büyük Beden: Evet · Cinsiyet: Kadın |
| 14 | Kadın > Giyim > Trençkot | Giyim > Dış Giyim > Trençkot | Cinsiyet: Kadın |
| 15 | Kadın > Giyim > Yağmurluk & Rüzgarlık | Giyim > Dış Giyim > Yağmurluk & Rüzgarlık | Cinsiyet: Kadın |
| 16 | Kadın > Giyim > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Kadın |
| 17 | Kadın > Giyim > Kaban | Giyim > Dış Giyim > Kaban | Cinsiyet: Kadın |
| 18 | Kadın > Giyim > Hırka | Giyim > Üst Giyim > Hırka | Cinsiyet: Kadın |
| 19 | Kadın > Giyim > Palto | Giyim > Dış Giyim > Palto | Cinsiyet: Kadın |
| 20 | Kadın > Ayakkabı > Topuklu Ayakkabı | Ayakkabı > Klasik & Topuklu > Topuklu Ayakkabı | Cinsiyet: Kadın |
| 21 | Kadın > Ayakkabı > Sneaker | Ayakkabı > Sneaker & Günlük > Sneaker | Cinsiyet: Kadın |
| 22 | Kadın > Ayakkabı > Günlük Ayakkabı | Ayakkabı > Sneaker & Günlük > Günlük Ayakkabı | Cinsiyet: Kadın |
| 23 | Kadın > Ayakkabı > Babet | Ayakkabı > Sneaker & Günlük > Babet | Cinsiyet: Kadın |
| 24 | Kadın > Ayakkabı > Sandalet | Ayakkabı > Sandalet & Terlik > Sandalet | Cinsiyet: Kadın |
| 25 | Kadın > Ayakkabı > Bot | Ayakkabı > Bot & Çizme > Bot | Cinsiyet: Kadın |
| 26 | Kadın > Ayakkabı > Çizme | Ayakkabı > Bot & Çizme > Çizme | Cinsiyet: Kadın |
| 27 | Kadın > Ayakkabı > Kar Botu | Ayakkabı > Bot & Çizme > Kar Botu | Cinsiyet: Kadın |
| 28 | Kadın > Ayakkabı > Loafer | Ayakkabı > Sneaker & Günlük > Loafer | Cinsiyet: Kadın |
| 29 | Kadın > Çanta > Omuz Çantası | Aksesuar > Çanta > Omuz Çantası | Cinsiyet: Kadın |
| 30 | Kadın > Çanta > Sırt Çantası | Aksesuar > Çanta > Sırt Çantası | Cinsiyet: Kadın |
| 31 | Kadın > Çanta > Bel Çantası | Aksesuar > Çanta > Bel Çantası | Cinsiyet: Kadın |
| 32 | Kadın > Çanta > Okul Çantası | Aksesuar > Çanta > Okul Çantası | Cinsiyet: Kadın |
| 33 | Kadın > Çanta > Laptop Çantası | Aksesuar > Çanta > Laptop Çantası | Cinsiyet: Kadın |
| 34 | Kadın > Çanta > Portföy | Aksesuar > Çanta > Portföy | Cinsiyet: Kadın |
| 35 | Kadın > Çanta > Postacı Çantası | Aksesuar > Çanta > Postacı Çantası | Cinsiyet: Kadın |
| 36 | Kadın > Çanta > El Çantası | Aksesuar > Çanta > El Çantası | Cinsiyet: Kadın |
| 37 | Kadın > Çanta > Kanvas Çanta | Aksesuar > Çanta > Bez & Kanvas Çanta | Cinsiyet: Kadın |
| 38 | Kadın > Çanta > Makyaj Çantası | Aksesuar > Çanta > Makyaj Çantası | Cinsiyet: Kadın |
| 39 | Kadın > Çanta > Abiye Çanta | Aksesuar > Çanta > Abiye Çanta | Cinsiyet: Kadın |
| 40 | Kadın > Çanta > Çapraz Çanta | Aksesuar > Çanta > Çapraz Çanta | Cinsiyet: Kadın |
| 41 | Kadın > Çanta > Bez Çanta | Aksesuar > Çanta > Bez & Kanvas Çanta | Cinsiyet: Kadın |
| 42 | Kadın > Çanta > Anne Bebek Çantası | Anne & Çocuk > Taşıma & Güvenlik > Anne Bebek Çantası |  |
| 43 | Kadın > Çanta > Evrak Çantası | Aksesuar > Çanta > Evrak Çantası | Cinsiyet: Kadın |
| 44 | Kadın > Çanta > Tote Çanta | Aksesuar > Çanta > Tote Çanta | Cinsiyet: Kadın |
| 45 | Kadın > Çanta > Beslenme Çantası | Aksesuar > Çanta > Beslenme Çantası | Cinsiyet: Kadın |
| 46 | Kadın > Çanta > Kartlık | Aksesuar > Cüzdan & Kartlık > Kartlık | Cinsiyet: Kadın |
| 47 | Kadın > Çanta > Cüzdan | Aksesuar > Cüzdan & Kartlık > Cüzdan | Cinsiyet: Kadın |
| 48 | Kadın > Çanta > Kadın Spor Çantası | Aksesuar > Çanta > Spor Çantası | Cinsiyet: Kadın |
| 49 | Kadın > Aksesuar & Çanta > Çanta | Aksesuar > Çanta (dalın tamamı) | Cinsiyet: Kadın |
| 50 | Kadın > Aksesuar & Çanta > Saat | Aksesuar > Saat & Gözlük > Kol Saati | Cinsiyet: Kadın |
| 51 | Kadın > Aksesuar & Çanta > Takı | Aksesuar > Takı > Kolye, Küpe, Bileklik, Yüzük, Broş, Takı Seti | Cinsiyet: Kadın |
| 52 | Kadın > Aksesuar & Çanta > Cüzdan | Aksesuar > Cüzdan & Kartlık > Cüzdan | Cinsiyet: Kadın |
| 53 | Kadın > Aksesuar & Çanta > Atkı | Aksesuar > Atkı, Şal & Eşarp > Atkı | Cinsiyet: Kadın |
| 54 | Kadın > Aksesuar & Çanta > Bere | Aksesuar > Şapka, Bere & Eldiven > Bere | Cinsiyet: Kadın |
| 55 | Kadın > Aksesuar & Çanta > Eldiven | Aksesuar > Şapka, Bere & Eldiven > Eldiven | Cinsiyet: Kadın |
| 56 | Kadın > Aksesuar & Çanta > Kemer | Aksesuar > Kemer & Kravat > Kemer | Cinsiyet: Kadın |
| 57 | Kadın > Aksesuar & Çanta > Şal | Aksesuar > Atkı, Şal & Eşarp > Şal | Cinsiyet: Kadın |
| 58 | Kadın > Ev & İç Giyim > Pijama Takımı | Giyim > İç Giyim & Ev Giyimi > Pijama Takımı | Cinsiyet: Kadın |
| 59 | Kadın > Ev & İç Giyim > Gecelik | Giyim > İç Giyim & Ev Giyimi > Gecelik | Cinsiyet: Kadın |
| 60 | Kadın > Ev & İç Giyim > Sütyen | Giyim > İç Giyim & Ev Giyimi > Sütyen | Cinsiyet: Kadın |
| 61 | Kadın > Ev & İç Giyim > İç Çamaşırı Takımları | Giyim > İç Giyim & Ev Giyimi > İç Çamaşırı Takımı | Cinsiyet: Kadın |
| 62 | Kadın > Ev & İç Giyim > Fantezi Giyim | Giyim > İç Giyim & Ev Giyimi > Fantezi Giyim | Cinsiyet: Kadın |
| 63 | Kadın > Ev & İç Giyim > Çorap | Giyim > İç Giyim & Ev Giyimi > Çorap | Cinsiyet: Kadın |
| 64 | Kadın > Ev & İç Giyim > Korse | Giyim > İç Giyim & Ev Giyimi > Korse | Cinsiyet: Kadın |
| 65 | Kadın > Ev & İç Giyim > Külot | Giyim > İç Giyim & Ev Giyimi > Külot | Cinsiyet: Kadın |
| 66 | Kadın > Ev & İç Giyim > Büstiyer | Giyim > İç Giyim & Ev Giyimi > Büstiyer | Cinsiyet: Kadın |
| 67 | Kadın > Ev & İç Giyim > Bralet | Giyim > İç Giyim & Ev Giyimi > Bralet | Cinsiyet: Kadın |
| 68 | Kadın > Ev & İç Giyim > Atlet & Body | Giyim > İç Giyim & Ev Giyimi > Atlet & Body | Cinsiyet: Kadın |
| 69 | Kadın > Ev & İç Giyim > Kombinezon | Giyim > İç Giyim & Ev Giyimi > Kombinezon | Cinsiyet: Kadın |
| 70 | Kadın > Ev & İç Giyim > Jartiyer | Giyim > İç Giyim & Ev Giyimi > Jartiyer | Cinsiyet: Kadın |
| 71 | Kadın > Kozmetik > Parfüm | Kozmetik & Kişisel Bakım > Parfüm & Deodorant > Parfüm | Cinsiyet: Kadın |
| 72 | Kadın > Kozmetik > Göz Makyajı | Kozmetik & Kişisel Bakım > Makyaj > Göz Farı, Maskara, Eyeliner & Göz Kalemi, Kaş Makyajı |  |
| 73 | Kadın > Kozmetik > Cilt Bakım | Kozmetik & Kişisel Bakım > Cilt Bakımı (dalın tamamı) |  |
| 74 | Kadın > Kozmetik > Saç Bakımı | Kozmetik & Kişisel Bakım > Saç Bakımı (dalın tamamı) |  |
| 75 | Kadın > Kozmetik > Makyaj | Kozmetik & Kişisel Bakım > Makyaj (dalın tamamı) |  |
| 76 | Kadın > Kozmetik > Ağız Bakım | Kozmetik & Kişisel Bakım > Ağız & Diş Bakımı (dalın tamamı) |  |
| 77 | Kadın > Kozmetik > Cinsel Sağlık | Kozmetik & Kişisel Bakım > Cinsel Sağlık (dalın tamamı) |  |
| 78 | Kadın > Kozmetik > Vücut Bakım | Kozmetik & Kişisel Bakım > Cilt Bakımı > Vücut Bakımı |  |
| 79 | Kadın > Kozmetik > Hijyenik Ped | Kozmetik & Kişisel Bakım > Kadın Hijyen > Hijyenik Ped |  |
| 80 | Kadın > Kozmetik > Duş Jeli & Kremleri | Kozmetik & Kişisel Bakım > Banyo & Duş > Duş Jeli & Kremi |  |
| 81 | Kadın > Kozmetik > Ruj | Kozmetik & Kişisel Bakım > Makyaj > Ruj |  |
| 82 | Kadın > Kozmetik > Dudak Nemlendirici | Kozmetik & Kişisel Bakım > Cilt Bakımı > Dudak Bakımı |  |
| 83 | Kadın > Kozmetik > Aydınlatıcı & Highlighter | Kozmetik & Kişisel Bakım > Makyaj > Aydınlatıcı & Highlighter |  |
| 84 | Kadın > Kozmetik > Eyeliner | Kozmetik & Kişisel Bakım > Makyaj > Eyeliner & Göz Kalemi |  |
| 85 | Kadın > Kozmetik > Ten Makyajı | Kozmetik & Kişisel Bakım > Makyaj > Fondöten, Kapatıcı, Pudra |  |
| 86 | Kadın > Kozmetik > Manikür & Pedikür | Kozmetik & Kişisel Bakım > El, Ayak & Tırnak Bakımı > Manikür & Pedikür |  |
| 87 | Kadın > Kozmetik > BB & CC Krem | Kozmetik & Kişisel Bakım > Makyaj > BB & CC Krem |  |
| 88 | Kadın > Kozmetik > El Kremi | Kozmetik & Kişisel Bakım > El, Ayak & Tırnak Bakımı > El Kremi |  |
| 89 | Kadın > Kozmetik > Yüz Nemlendirici | Kozmetik & Kişisel Bakım > Cilt Bakımı > Yüz Nemlendirici |  |
| 90 | Kadın > Spor & Outdoor > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Kadın · Kullanım: Spor |
| 91 | Kadın > Spor & Outdoor > Tişört | Giyim > Üst Giyim > Tişört | Cinsiyet: Kadın · Kullanım: Spor |
| 92 | Kadın > Spor & Outdoor > Spor Sütyeni | Giyim > İç Giyim & Ev Giyimi > Spor Sütyeni | Cinsiyet: Kadın · Kullanım: Spor |
| 93 | Kadın > Spor & Outdoor > Tayt | Giyim > Alt Giyim > Tayt | Cinsiyet: Kadın · Kullanım: Spor |
| 94 | Kadın > Spor & Outdoor > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Kadın · Kullanım: Spor |
| 95 | Kadın > Spor & Outdoor > Koşu Ayakkabısı | Ayakkabı > Spor Ayakkabı > Koşu Ayakkabısı | Cinsiyet: Kadın · Kullanım: Spor |
| 96 | Kadın > Spor & Outdoor > Spor Çantası | Aksesuar > Çanta > Spor Çantası | Cinsiyet: Kadın |
| 97 | Kadın > Spor & Outdoor > Spor Ekipmanları | Spor & Outdoor > Fitness & Kondisyon > Ağırlık & Dambıl · Spor & Outdoor > Fitness & Kondisyon > Direnç Bandı · Spor & Outdoor > Takım & Raket Sporları > Top · Spor & Outdoor > Takım & Raket Sporları > Raket · Spor & Outdoor > Takım & Raket Sporları > Koruyucu Ekipman |  |
| 98 | Kadın > Spor & Outdoor > Outdoor Ayakkabı | Ayakkabı > Spor Ayakkabı > Outdoor & Trekking Ayakkabısı | Cinsiyet: Kadın · Kullanım: Outdoor |
| 99 | Kadın > Spor & Outdoor > Kar Botu | Ayakkabı > Bot & Çizme > Kar Botu | Cinsiyet: Kadın · Kullanım: Outdoor |
| 100 | Kadın > Spor & Outdoor > Outdoor Ekipmanları | Spor & Outdoor > Kamp & Outdoor > Outdoor Ekipmanları |  |
| 101 | Kadın > Spor & Outdoor > Sporcu Besinleri | — (çıkarıldı) | Gıda/takviye — şimdilik ağaçta yok (karar: madde 2, gıda) |
| 102 | Kadın > Spor & Outdoor > Sporcu Aksesuarları | Spor & Outdoor > Fitness & Kondisyon > Spor Aksesuarları |  |
| 103 | Kadın > Spor & Outdoor > Outdoor Çanta | Aksesuar > Çanta > Sırt Çantası | Cinsiyet: Kadın |
| 104 | Kadın > Spor & Outdoor > Kayak Malzemeleri | Spor & Outdoor > Doğa Sporları > Kayak & Kar Sporları |  |
| 105 | Kadın > Spor & Outdoor > Uyku Tulumu | Spor & Outdoor > Kamp & Outdoor > Uyku Tulumu |  |
| 106 | Kadın > Spor & Outdoor > Mat | Spor & Outdoor > Fitness & Kondisyon > Yoga & Pilates Matı |  |
| 107 | Kadın > Spor & Outdoor > Dağcılık | Spor & Outdoor > Doğa Sporları > Dağcılık & Tırmanış |  |
| 108 | Kadın > Spor & Outdoor > Kadın Spor Ceket | Giyim > Dış Giyim > Ceket | Cinsiyet: Kadın · Kullanım: Spor |
| 109 | Kadın > Spor & Outdoor > Spor Ayakkabı | Ayakkabı > Spor Ayakkabı > Antrenman Ayakkabısı | Cinsiyet: Kadın · Kullanım: Spor |
| 110 | Erkek > Giyim > Tişört | Giyim > Üst Giyim > Tişört | Cinsiyet: Erkek |
| 111 | Erkek > Giyim > Şort | Giyim > Alt Giyim > Şort | Cinsiyet: Erkek |
| 112 | Erkek > Giyim > Gömlek | Giyim > Üst Giyim > Gömlek | Cinsiyet: Erkek |
| 113 | Erkek > Giyim > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Erkek |
| 114 | Erkek > Giyim > Pantolon | Giyim > Alt Giyim > Pantolon | Cinsiyet: Erkek |
| 115 | Erkek > Giyim > Ceket | Giyim > Dış Giyim > Ceket | Cinsiyet: Erkek |
| 116 | Erkek > Giyim > Kot Pantolon | Giyim > Alt Giyim > Kot Pantolon | Cinsiyet: Erkek |
| 117 | Erkek > Giyim > Yelek | Giyim > Üst Giyim > Yelek | Cinsiyet: Erkek |
| 118 | Erkek > Giyim > Kazak | Giyim > Üst Giyim > Kazak | Cinsiyet: Erkek |
| 119 | Erkek > Giyim > Mont | Giyim > Dış Giyim > Mont | Cinsiyet: Erkek |
| 120 | Erkek > Giyim > Takım Elbise | Giyim > Takım & Set > Takım Elbise | Cinsiyet: Erkek |
| 121 | Erkek > Giyim > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Erkek |
| 122 | Erkek > Giyim > Deri Mont | Giyim > Dış Giyim > Deri Ceket & Mont | Cinsiyet: Erkek |
| 123 | Erkek > Giyim > Kaban | Giyim > Dış Giyim > Kaban | Cinsiyet: Erkek |
| 124 | Erkek > Giyim > Hırka | Giyim > Üst Giyim > Hırka | Cinsiyet: Erkek |
| 125 | Erkek > Giyim > Trençkot | Giyim > Dış Giyim > Trençkot | Cinsiyet: Erkek |
| 126 | Erkek > Giyim > Palto | Giyim > Dış Giyim > Palto | Cinsiyet: Erkek |
| 127 | Erkek > Giyim > Yağmurluk | Giyim > Dış Giyim > Yağmurluk & Rüzgarlık | Cinsiyet: Erkek |
| 128 | Erkek > Giyim > Blazer | Giyim > Dış Giyim > Blazer Ceket | Cinsiyet: Erkek |
| 129 | Erkek > Giyim > Polar | Giyim > Üst Giyim > Polar | Cinsiyet: Erkek |
| 130 | Erkek > Ayakkabı > Spor Ayakkabı | Ayakkabı > Spor Ayakkabı > Antrenman Ayakkabısı | Cinsiyet: Erkek |
| 131 | Erkek > Ayakkabı > Günlük Ayakkabı | Ayakkabı > Sneaker & Günlük > Günlük Ayakkabı | Cinsiyet: Erkek |
| 132 | Erkek > Ayakkabı > Yürüyüş Ayakkabısı | Ayakkabı > Spor Ayakkabı > Yürüyüş Ayakkabısı | Cinsiyet: Erkek |
| 133 | Erkek > Ayakkabı > Krampon | Ayakkabı > Spor Ayakkabı > Krampon | Cinsiyet: Erkek |
| 134 | Erkek > Ayakkabı > Sneaker | Ayakkabı > Sneaker & Günlük > Sneaker | Cinsiyet: Erkek |
| 135 | Erkek > Ayakkabı > Klasik | Ayakkabı > Klasik & Topuklu > Klasik Ayakkabı | Cinsiyet: Erkek |
| 136 | Erkek > Ayakkabı > Bot | Ayakkabı > Bot & Çizme > Bot | Cinsiyet: Erkek |
| 137 | Erkek > Ayakkabı > Kar Botu | Ayakkabı > Bot & Çizme > Kar Botu | Cinsiyet: Erkek |
| 138 | Erkek > Ayakkabı > Deri ayakkabı | — (dal değil, filtre) → ilgili ayakkabı tipine yüklenir (Klasik, Günlük, Loafer…) | Materyal (dış): Deri · Cinsiyet: Erkek |
| 139 | Erkek > Ayakkabı > Loafer | Ayakkabı > Sneaker & Günlük > Loafer | Cinsiyet: Erkek |
| 140 | Erkek > Ayakkabı > Ev Terliği | Ayakkabı > Sandalet & Terlik > Ev Terliği | Cinsiyet: Erkek |
| 141 | Erkek > Ayakkabı > Koşu Ayakkabısı | Ayakkabı > Spor Ayakkabı > Koşu Ayakkabısı | Cinsiyet: Erkek |
| 142 | Erkek > Ayakkabı > Çizme | Ayakkabı > Bot & Çizme > Çizme | Cinsiyet: Erkek |
| 143 | Erkek > Kişisel Bakım > Parfüm | Kozmetik & Kişisel Bakım > Parfüm & Deodorant > Parfüm | Cinsiyet: Erkek |
| 144 | Erkek > Kişisel Bakım > Cinsel Sağlık | Kozmetik & Kişisel Bakım > Cinsel Sağlık (dalın tamamı) |  |
| 145 | Erkek > Kişisel Bakım > Tıraş Bıçağı | Kozmetik & Kişisel Bakım > Tıraş & Erkek Bakımı > Tıraş Bıçağı | Cinsiyet: Erkek |
| 146 | Erkek > Kişisel Bakım > Deodorant | Kozmetik & Kişisel Bakım > Parfüm & Deodorant > Deodorant | Cinsiyet: Erkek |
| 147 | Erkek > Çanta > Sırt Çantası | Aksesuar > Çanta > Sırt Çantası | Cinsiyet: Erkek |
| 148 | Erkek > Çanta > Spor Çanta | Aksesuar > Çanta > Spor Çantası | Cinsiyet: Erkek |
| 149 | Erkek > Çanta > Laptop Çantası | Aksesuar > Çanta > Laptop Çantası | Cinsiyet: Erkek |
| 150 | Erkek > Çanta > Valiz & Bavul | Aksesuar > Çanta > Valiz & Bavul | Cinsiyet: Erkek |
| 151 | Erkek > Çanta > Postacı Çantası | Aksesuar > Çanta > Postacı Çantası | Cinsiyet: Erkek |
| 152 | Erkek > Çanta > Bel Çantası | Aksesuar > Çanta > Bel Çantası | Cinsiyet: Erkek |
| 153 | Erkek > Çanta > Bez Çanta | Aksesuar > Çanta > Bez & Kanvas Çanta | Cinsiyet: Erkek |
| 154 | Erkek > Çanta > Evrak Çantası | Aksesuar > Çanta > Evrak Çantası | Cinsiyet: Erkek |
| 155 | Erkek > Çanta > Cüzdan | Aksesuar > Cüzdan & Kartlık > Cüzdan | Cinsiyet: Erkek |
| 156 | Erkek > Büyük Beden > Büyük Beden Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Erkek · Büyük Beden: Evet |
| 157 | Erkek > Büyük Beden > Büyük Beden T-shirt | Giyim > Üst Giyim > Tişört | Cinsiyet: Erkek · Büyük Beden: Evet |
| 158 | Erkek > Büyük Beden > Büyük Beden Gömlek | Giyim > Üst Giyim > Gömlek | Cinsiyet: Erkek · Büyük Beden: Evet |
| 159 | Erkek > Büyük Beden > Büyük Beden Pantolon | Giyim > Alt Giyim > Pantolon | Cinsiyet: Erkek · Büyük Beden: Evet |
| 160 | Erkek > Büyük Beden > Büyük Beden Mont | Giyim > Dış Giyim > Mont | Cinsiyet: Erkek · Büyük Beden: Evet |
| 161 | Erkek > Büyük Beden > Büyük Beden Kazak | Giyim > Üst Giyim > Kazak | Cinsiyet: Erkek · Büyük Beden: Evet |
| 162 | Erkek > Büyük Beden > Büyük Beden Hırka | Giyim > Üst Giyim > Hırka | Cinsiyet: Erkek · Büyük Beden: Evet |
| 163 | Erkek > Büyük Beden > Büyük Beden Kaban | Giyim > Dış Giyim > Kaban | Cinsiyet: Erkek · Büyük Beden: Evet |
| 164 | Erkek > Büyük Beden > Büyük Beden Eşofman Altı | Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Erkek · Büyük Beden: Evet |
| 165 | Erkek > Saat & Aksesuar > Saat | Aksesuar > Saat & Gözlük > Kol Saati | Cinsiyet: Erkek |
| 166 | Erkek > Saat & Aksesuar > Güneş Gözlüğü | Aksesuar > Saat & Gözlük > Güneş Gözlüğü | Cinsiyet: Erkek |
| 167 | Erkek > Saat & Aksesuar > Cüzdan | Aksesuar > Cüzdan & Kartlık > Cüzdan | Cinsiyet: Erkek |
| 168 | Erkek > Saat & Aksesuar > Kemer | Aksesuar > Kemer & Kravat > Kemer | Cinsiyet: Erkek |
| 169 | Erkek > Saat & Aksesuar > Çanta | Aksesuar > Çanta (dalın tamamı) | Cinsiyet: Erkek |
| 170 | Erkek > Saat & Aksesuar > Şapka | Aksesuar > Şapka, Bere & Eldiven > Şapka | Cinsiyet: Erkek |
| 171 | Erkek > Saat & Aksesuar > Kartlık | Aksesuar > Cüzdan & Kartlık > Kartlık | Cinsiyet: Erkek |
| 172 | Erkek > Saat & Aksesuar > Valiz | Aksesuar > Çanta > Valiz & Bavul | Cinsiyet: Erkek |
| 173 | Erkek > Saat & Aksesuar > Kravat | Aksesuar > Kemer & Kravat > Kravat & Papyon | Cinsiyet: Erkek |
| 174 | Erkek > Saat & Aksesuar > Boyunluk | Aksesuar > Şapka, Bere & Eldiven > Boyunluk | Cinsiyet: Erkek |
| 175 | Erkek > Saat & Aksesuar > Atkı | Aksesuar > Atkı, Şal & Eşarp > Atkı | Cinsiyet: Erkek |
| 176 | Erkek > Saat & Aksesuar > Bere | Aksesuar > Şapka, Bere & Eldiven > Bere | Cinsiyet: Erkek |
| 177 | Erkek > Saat & Aksesuar > Eldiven | Aksesuar > Şapka, Bere & Eldiven > Eldiven | Cinsiyet: Erkek |
| 178 | Erkek > İç Giyim > Boxer | Giyim > İç Giyim & Ev Giyimi > Boxer | Cinsiyet: Erkek |
| 179 | Erkek > İç Giyim > Çorap | Giyim > İç Giyim & Ev Giyimi > Çorap | Cinsiyet: Erkek |
| 180 | Erkek > İç Giyim > Pijama | Giyim > İç Giyim & Ev Giyimi > Pijama Takımı | Cinsiyet: Erkek |
| 181 | Erkek > İç Giyim > Atlet | Giyim > İç Giyim & Ev Giyimi > Atlet & Body | Cinsiyet: Erkek |
| 182 | Erkek > İç Giyim > İçlik | Giyim > İç Giyim & Ev Giyimi > İçlik | Cinsiyet: Erkek |
| 183 | Erkek > Spor & Outdoor > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Erkek · Kullanım: Spor |
| 184 | Erkek > Spor & Outdoor > Spor Ayakkabı | Ayakkabı > Spor Ayakkabı > Antrenman Ayakkabısı | Cinsiyet: Erkek · Kullanım: Spor |
| 185 | Erkek > Spor & Outdoor > T-shirt | Giyim > Üst Giyim > Tişört | Cinsiyet: Erkek · Kullanım: Spor |
| 186 | Erkek > Spor & Outdoor > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Erkek · Kullanım: Spor |
| 187 | Erkek > Spor & Outdoor > Forma | Giyim > Üst Giyim > Forma | Cinsiyet: Erkek · Kullanım: Spor |
| 188 | Erkek > Spor & Outdoor > Spor Çorap | Giyim > İç Giyim & Ev Giyimi > Çorap | Cinsiyet: Erkek · Kullanım: Spor |
| 189 | Erkek > Spor & Outdoor > Spor Giyim | — (dal değil, filtre) → ürün tipine göre Giyim dallarına yüklenir | Kullanım: Spor · Cinsiyet: Erkek |
| 190 | Erkek > Spor & Outdoor > Outdoor Ayakkabı | Ayakkabı > Spor Ayakkabı > Outdoor & Trekking Ayakkabısı | Cinsiyet: Erkek · Kullanım: Outdoor |
| 191 | Erkek > Spor & Outdoor > Outdoor Bot | Ayakkabı > Bot & Çizme > Outdoor Bot | Cinsiyet: Erkek · Kullanım: Outdoor |
| 192 | Erkek > Spor & Outdoor > Spor Ekipmanları | Spor & Outdoor > Fitness & Kondisyon > Ağırlık & Dambıl · Spor & Outdoor > Fitness & Kondisyon > Direnç Bandı · Spor & Outdoor > Takım & Raket Sporları > Top · Spor & Outdoor > Takım & Raket Sporları > Raket · Spor & Outdoor > Takım & Raket Sporları > Koruyucu Ekipman |  |
| 193 | Erkek > Spor & Outdoor > Outdoor Ekipmanları | Spor & Outdoor > Kamp & Outdoor > Outdoor Ekipmanları |  |
| 194 | Erkek > Spor & Outdoor > Sporcu Besinleri | — (çıkarıldı) | Gıda/takviye — şimdilik ağaçta yok (karar: madde 2, gıda) |
| 195 | Erkek > Spor & Outdoor > Sporcu Aksesuarları | Spor & Outdoor > Fitness & Kondisyon > Spor Aksesuarları |  |
| 196 | Erkek > Spor & Outdoor > Sneaker | Ayakkabı > Sneaker & Günlük > Sneaker | Cinsiyet: Erkek · Kullanım: Spor |
| 197 | Erkek > Spor & Outdoor > Scooter | Spor & Outdoor > Bisiklet & Scooter > Scooter |  |
| 198 | Erkek > Spor & Outdoor > Bisiklet | Spor & Outdoor > Bisiklet & Scooter > Bisiklet |  |
| 199 | Erkek > Spor & Outdoor > Dalış Malzemeleri | Spor & Outdoor > Doğa Sporları > Dalış & Su Sporları |  |
| 200 | Erkek > Spor & Outdoor > Rüzgarlık | Giyim > Dış Giyim > Yağmurluk & Rüzgarlık | Cinsiyet: Erkek · Kullanım: Outdoor |
| 201 | Erkek > Spor & Outdoor > Aksiyon Kamerası | Elektronik > Foto & Kamera > Aksiyon Kamerası |  |
| 202 | Erkek > Spor & Outdoor > Kamp Malzemeleri | Spor & Outdoor > Kamp & Outdoor > Çadır, Kamp Mobilyası, Kamp Mutfağı & Termos, Fener & Kamp Aydınlatması |  |
| 203 | Anne&Çocuk > Bebek > Bebek Takımları | Giyim > Takım & Set > Alt Üst Takım | Yaş Grubu: Bebek |
| 204 | Anne&Çocuk > Bebek > Ayakkabı | Ayakkabı > Bebek Ayakkabısı > İlk Adım Ayakkabısı | Yaş Grubu: Bebek |
| 205 | Anne&Çocuk > Bebek > Hastane Çıkışı | Giyim > Takım & Set > Hastane Çıkışı Seti | Yaş Grubu: Bebek |
| 206 | Anne&Çocuk > Bebek > Yenidoğan Kıyafetleri | — (dal değil, filtre) → ilgili giyim tipine yüklenir (Body & Zıbın, Tulum…) | Yaş Grubu: Bebek · Beden: 0-1 Ay |
| 207 | Anne&Çocuk > Bebek > Tulum | Giyim > Elbise & Tulum > Tulum | Yaş Grubu: Bebek |
| 208 | Anne&Çocuk > Bebek > Body & Zıbın | Giyim > Üst Giyim > Body & Zıbın | Yaş Grubu: Bebek |
| 209 | Anne&Çocuk > Bebek > Tişört & Atlet | Giyim > Üst Giyim > Tişört · Giyim > İç Giyim & Ev Giyimi > Atlet & Body | Yaş Grubu: Bebek |
| 210 | Anne&Çocuk > Bebek > Elbise | Giyim > Elbise & Tulum > Elbise | Yaş Grubu: Bebek |
| 211 | Anne&Çocuk > Bebek > Şort | Giyim > Alt Giyim > Şort | Yaş Grubu: Bebek |
| 212 | Anne&Çocuk > Bebek > Bebek Patiği | Ayakkabı > Bebek Ayakkabısı > Bebek Patiği | Yaş Grubu: Bebek |
| 213 | Anne&Çocuk > Bebek > Hırka | Giyim > Üst Giyim > Hırka | Yaş Grubu: Bebek |
| 214 | Anne&Çocuk > Bebek > Battaniye | Anne & Çocuk > Bebek Odası > Bebek Battaniyesi |  |
| 215 | Anne&Çocuk > Bebek > Alt Üst Takım | Giyim > Takım & Set > Alt Üst Takım | Yaş Grubu: Bebek |
| 216 | Anne&Çocuk > Bebek > Tişört | Giyim > Üst Giyim > Tişört | Yaş Grubu: Bebek |
| 217 | Anne&Çocuk > Bebek > Etek | Giyim > Alt Giyim > Etek | Yaş Grubu: Bebek |
| 218 | Anne&Çocuk > Bebek > Çorap | Giyim > İç Giyim & Ev Giyimi > Çorap | Yaş Grubu: Bebek |
| 219 | Anne&Çocuk > Bebek > Şapka | Aksesuar > Şapka, Bere & Eldiven > Şapka | Yaş Grubu: Bebek |
| 220 | Anne&Çocuk > Bebek > Eldiven | Aksesuar > Şapka, Bere & Eldiven > Eldiven | Yaş Grubu: Bebek |
| 221 | Anne&Çocuk > Bebek > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Yaş Grubu: Bebek |
| 222 | Anne&Çocuk > Bebek > Bere | Aksesuar > Şapka, Bere & Eldiven > Bere | Yaş Grubu: Bebek |
| 223 | Anne&Çocuk > Kız Çocuk > Elbise | Giyim > Elbise & Tulum > Elbise | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 224 | Anne&Çocuk > Kız Çocuk > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 225 | Anne&Çocuk > Kız Çocuk > Spor Ayakkabı | Ayakkabı > Spor Ayakkabı > Antrenman Ayakkabısı | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 226 | Anne&Çocuk > Kız Çocuk > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 227 | Anne&Çocuk > Kız Çocuk > İç Giyim & Pijama | Giyim > İç Giyim & Ev Giyimi (dalın tamamı) | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 228 | Anne&Çocuk > Kız Çocuk > Tişört & Atlet | Giyim > Üst Giyim > Tişört · Giyim > İç Giyim & Ev Giyimi > Atlet & Body | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 229 | Anne&Çocuk > Kız Çocuk > Tayt | Giyim > Alt Giyim > Tayt | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 230 | Anne&Çocuk > Kız Çocuk > Günlük Ayakkabı | Ayakkabı > Sneaker & Günlük > Günlük Ayakkabı | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 231 | Anne&Çocuk > Kız Çocuk > Şort | Giyim > Alt Giyim > Şort | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 232 | Anne&Çocuk > Kız Çocuk > Mont | Giyim > Dış Giyim > Mont | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 233 | Anne&Çocuk > Kız Çocuk > Kaban | Giyim > Dış Giyim > Kaban | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 234 | Anne&Çocuk > Kız Çocuk > Abiye & Elbise | Giyim > Elbise & Tulum > Abiye Elbise, Elbise | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 235 | Anne&Çocuk > Kız Çocuk > Ceket | Giyim > Dış Giyim > Ceket | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 236 | Anne&Çocuk > Kız Çocuk > Pantolon | Giyim > Alt Giyim > Pantolon | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 237 | Anne&Çocuk > Kız Çocuk > Kazak | Giyim > Üst Giyim > Kazak | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 238 | Anne&Çocuk > Kız Çocuk > Bot | Ayakkabı > Bot & Çizme > Bot | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 239 | Anne&Çocuk > Kız Çocuk > Şapka & Bere & Eldiven | Aksesuar > Şapka, Bere & Eldiven > Şapka, Bere, Eldiven | Cinsiyet: Kadın/Kız · Yaş Grubu: Çocuk |
| 240 | Anne&Çocuk > Erkek Çocuk > Sweatshirt | Giyim > Üst Giyim > Sweatshirt | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 241 | Anne&Çocuk > Erkek Çocuk > Spor Ayakkabı | Ayakkabı > Spor Ayakkabı > Antrenman Ayakkabısı | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 242 | Anne&Çocuk > Erkek Çocuk > Eşofman | Giyim > Takım & Set > Eşofman Takımı · Giyim > Alt Giyim > Eşofman Altı | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 243 | Anne&Çocuk > Erkek Çocuk > İç Giyim & Pijama | Giyim > İç Giyim & Ev Giyimi (dalın tamamı) | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 244 | Anne&Çocuk > Erkek Çocuk > Tişört & Atlet | Giyim > Üst Giyim > Tişört · Giyim > İç Giyim & Ev Giyimi > Atlet & Body | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 245 | Anne&Çocuk > Erkek Çocuk > Günlük Ayakkabı | Ayakkabı > Sneaker & Günlük > Günlük Ayakkabı | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 246 | Anne&Çocuk > Erkek Çocuk > Okul Çantası | Aksesuar > Çanta > Okul Çantası | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 247 | Anne&Çocuk > Erkek Çocuk > Şort | Giyim > Alt Giyim > Şort | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 248 | Anne&Çocuk > Erkek Çocuk > Gömlek | Giyim > Üst Giyim > Gömlek | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 249 | Anne&Çocuk > Erkek Çocuk > Mont | Giyim > Dış Giyim > Mont | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 250 | Anne&Çocuk > Erkek Çocuk > Boxer | Giyim > İç Giyim & Ev Giyimi > Boxer | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 251 | Anne&Çocuk > Erkek Çocuk > İçlik | Giyim > İç Giyim & Ev Giyimi > İçlik | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 252 | Anne&Çocuk > Erkek Çocuk > Bot | Ayakkabı > Bot & Çizme > Bot | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 253 | Anne&Çocuk > Erkek Çocuk > Krampon | Ayakkabı > Spor Ayakkabı > Krampon | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 254 | Anne&Çocuk > Erkek Çocuk > Şapka & Bere & Eldiven | Aksesuar > Şapka, Bere & Eldiven > Şapka, Bere, Eldiven | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 255 | Anne&Çocuk > Erkek Çocuk > Takım Elbise | Giyim > Takım & Set > Takım Elbise | Cinsiyet: Erkek · Yaş Grubu: Çocuk |
| 256 | Anne&Çocuk > Bebek Bakım > Bebek Bezi | Anne & Çocuk > Bebek Bakım > Bebek Bezi |  |
| 257 | Anne&Çocuk > Bebek Bakım > Bebek Şampuanı | Anne & Çocuk > Bebek Bakım > Bebek Şampuanı |  |
| 258 | Anne&Çocuk > Bebek Bakım > Krem & Yağlar | Anne & Çocuk > Bebek Bakım > Bebek Kremi & Losyonu, Bebek Yağı |  |
| 259 | Anne&Çocuk > Bebek Bakım > Bebek Çantası | Anne & Çocuk > Taşıma & Güvenlik > Anne Bebek Çantası |  |
| 260 | Anne&Çocuk > Bebek Bakım > Bebek Sabunları | Anne & Çocuk > Bebek Bakım > Bebek Sabunu |  |
| 261 | Anne&Çocuk > Bebek Bakım > Bebek Deterjanları | Anne & Çocuk > Bebek Bakım > Bebek Deterjanı |  |
| 262 | Anne&Çocuk > Bebek Bakım > Bebek Vücut Kremi | Anne & Çocuk > Bebek Bakım > Bebek Kremi & Losyonu |  |
| 263 | Anne&Çocuk > Bebek Bakım > Islak Mendil | Anne & Çocuk > Bebek Bakım > Islak Mendil |  |
| 264 | Anne&Çocuk > Bebek Bakım > Bebek Yağı | Anne & Çocuk > Bebek Bakım > Bebek Yağı |  |
| 265 | Anne&Çocuk > Bebek Bakım > Bebek Buhar Makinesi | Anne & Çocuk > Bebek Bakım > Bebek Buhar Makinesi |  |
| 266 | Anne&Çocuk > Oyuncak > Eğitici Oyuncaklar | Anne & Çocuk > Oyuncak > Eğitici Oyuncak |  |
| 267 | Anne&Çocuk > Oyuncak > Oyuncak Araba | Anne & Çocuk > Oyuncak > Oyuncak Araba |  |
| 268 | Anne&Çocuk > Oyuncak > Oyuncak Bebek | Anne & Çocuk > Oyuncak > Oyuncak Bebek |  |
| 269 | Anne&Çocuk > Oyuncak > Bebek & Okul Öncesi | Anne & Çocuk > Oyuncak > Bebek & Okul Öncesi Oyuncak |  |
| 270 | Anne&Çocuk > Oyuncak > Kumandalı Oyuncak | Anne & Çocuk > Oyuncak > Kumandalı Oyuncak |  |
| 271 | Anne&Çocuk > Oyuncak > Robot Oyuncak | Anne & Çocuk > Oyuncak > Robot Oyuncak |  |
| 272 | Anne&Çocuk > Oyuncak > Çocuk Çizim Tableti | Anne & Çocuk > Oyuncak > Çocuk Çizim Tableti |  |
| 273 | Anne&Çocuk > Beslenme Emzirme > Biberon & Emzik | Anne & Çocuk > Beslenme & Emzirme > Biberon & Emzik |  |
| 274 | Anne&Çocuk > Beslenme Emzirme > Göğüs Pompası | Anne & Çocuk > Beslenme & Emzirme > Göğüs Pompası |  |
| 275 | Anne&Çocuk > Beslenme Emzirme > Mama Sandalyesi | Anne & Çocuk > Beslenme & Emzirme > Mama Sandalyesi |  |
| 276 | Anne&Çocuk > Beslenme Emzirme > Mama Önlüğü | Anne & Çocuk > Beslenme & Emzirme > Mama Önlüğü |  |
| 277 | Anne&Çocuk > Beslenme Emzirme > Alıştırma Bardağı | Anne & Çocuk > Beslenme & Emzirme > Alıştırma Bardağı |  |
| 278 | Anne&Çocuk > Beslenme Emzirme > Biberon Temizleyici | Anne & Çocuk > Beslenme & Emzirme > Biberon Temizleyici |  |
| 279 | Anne&Çocuk > Beslenme Emzirme > Biberon Seti | Anne & Çocuk > Beslenme & Emzirme > Biberon Seti |  |
| 280 | Anne&Çocuk > Beslenme Emzirme > Bebek Maması | — (çıkarıldı) | Gıda — şimdilik ağaçta yok |
| 281 | Anne&Çocuk > Beslenme Emzirme > Kavanoz Mama | — (çıkarıldı) | Gıda — şimdilik ağaçta yok |
| 282 | Anne&Çocuk > Beslenme Emzirme > Sterilizatör | Anne & Çocuk > Beslenme & Emzirme > Sterilizatör |  |
| 283 | Anne&Çocuk > Beslenme Emzirme > Bebek Bakım Çantası | Anne & Çocuk > Taşıma & Güvenlik > Anne Bebek Çantası |  |
| 284 | Anne&Çocuk > Beslenme Emzirme > Yemek Setleri | Anne & Çocuk > Beslenme & Emzirme > Yemek Seti |  |
| 285 | Anne&Çocuk > Beslenme Emzirme > Kaşık Maması | — (çıkarıldı) | Gıda — şimdilik ağaçta yok |
| 286 | Anne&Çocuk > Beslenme Emzirme > Buharlı Pişirici | Anne & Çocuk > Beslenme & Emzirme > Buharlı Pişirici |  |
| 287 | Anne&Çocuk > Beslenme Emzirme > Termal Çanta | Anne & Çocuk > Beslenme & Emzirme > Termal Çanta |  |
| 288 | Anne&Çocuk > Beslenme Emzirme > Süt Pompası | Anne & Çocuk > Beslenme & Emzirme > Göğüs Pompası |  |
| 289 | Anne&Çocuk > Beslenme Emzirme > Emzirme Önlüğü | Anne & Çocuk > Beslenme & Emzirme > Emzirme Önlüğü |  |
| 290 | Anne&Çocuk > Beslenme Emzirme > Emzirme Minderi | Anne & Çocuk > Beslenme & Emzirme > Emzirme Minderi |  |
| 291 | Anne&Çocuk > Beslenme Emzirme > Göğüs Pedi | Anne & Çocuk > Beslenme & Emzirme > Göğüs Pedi |  |
| 292 | Anne&Çocuk > Beslenme Emzirme > Göğüs Kremi | Anne & Çocuk > Beslenme & Emzirme > Göğüs Kremi |  |
| 293 | Anne&Çocuk > Taşıma & Güvenlik > Bebek Arabası & Puset | Anne & Çocuk > Taşıma & Güvenlik > Bebek Arabası & Puset |  |
| 294 | Anne&Çocuk > Taşıma & Güvenlik > Park Yatak | Anne & Çocuk > Taşıma & Güvenlik > Park Yatak |  |
| 295 | Anne&Çocuk > Taşıma & Güvenlik > Ana Kucağı | Anne & Çocuk > Taşıma & Güvenlik > Ana Kucağı |  |
| 296 | Anne&Çocuk > Taşıma & Güvenlik > Portbebe & Kanguru | Anne & Çocuk > Taşıma & Güvenlik > Portbebe & Kanguru |  |
| 297 | Anne&Çocuk > Taşıma & Güvenlik > Yürüteç | Anne & Çocuk > Taşıma & Güvenlik > Yürüteç |  |
| 298 | Anne&Çocuk > Taşıma & Güvenlik > Oto Koltuğu | Anne & Çocuk > Taşıma & Güvenlik > Oto Koltuğu |  |
| 299 | Anne&Çocuk > Taşıma & Güvenlik > Baston Puset | Anne & Çocuk > Taşıma & Güvenlik > Baston Puset |  |
| 300 | Anne&Çocuk > Taşıma & Güvenlik > Kanguru | Anne & Çocuk > Taşıma & Güvenlik > Portbebe & Kanguru |  |
| 301 | Anne&Çocuk > Taşıma & Güvenlik > Bebek Salıncakları | Anne & Çocuk > Taşıma & Güvenlik > Bebek Salıncağı |  |
| 302 | Anne&Çocuk > Bebek Odası > Bebek Beşiği | Anne & Çocuk > Bebek Odası > Beşik |  |
| 303 | Anne&Çocuk > Bebek Odası > Bebek Yatağı | Anne & Çocuk > Bebek Odası > Bebek Yatağı |  |
| 304 | Anne&Çocuk > Bebek Odası > Bebek Nevresimleri | Anne & Çocuk > Bebek Odası > Bebek Nevresimi |  |
| 305 | Anne&Çocuk > Bebek Odası > Oyuncak Sepetleri | Anne & Çocuk > Bebek Odası > Oyuncak Sepeti |  |
| 306 | Anne&Çocuk > Bebek Odası > Bebek Cibinlik | Anne & Çocuk > Bebek Odası > Cibinlik |  |
| 307 | Anne&Çocuk > Bebek Odası > Oyuncak Dolabı | Anne & Çocuk > Bebek Odası > Oyuncak Dolabı |  |
| 308 | Anne&Çocuk > Bebek Odası > Bebek Odası Mobilyaları | Anne & Çocuk > Bebek Odası > Bebek Odası Mobilyası |  |
| 309 | Anne&Çocuk > Bebek Odası > Bebek Oyun Matları | Anne & Çocuk > Bebek Odası > Oyun Matı |  |
| 310 | Anne&Çocuk > Bebek Odası > Bebek Oyun Parkı | Anne & Çocuk > Bebek Odası > Oyun Parkı |  |

---

## Ek B — Şablon başına yapraklar (50 şablon)

Zorunlu alan kontrolünün dayanağıdır: Bir şablondaki her `*` alanı ya da grubu, aşağıda o şablonun karşısında listelenen bütün yapraklar için anlamlı olmalıdır. Uygulamada bu tablo, yaprak başına zorunlu alan snapshot testinin beklenen değeridir (§3.5 Aşama 1, senaryo 5).

| Şablon | Yaprak sayısı | Yapraklar (Alt-1 > Yaprak) |
|---|---|---|
| `AKS-CANTA` | 18 | Çanta > Omuz Çantası · Çanta > El Çantası · Çanta > Çapraz Çanta · Çanta > Sırt Çantası · Çanta > Bel Çantası · Çanta > Postacı Çantası · Çanta > Tote Çanta · Çanta > Bez & Kanvas Çanta · Çanta > Abiye Çanta · Çanta > Portföy · Çanta > Laptop Çantası · Çanta > Evrak Çantası · Çanta > Okul Çantası · Çanta > Beslenme Çantası · Çanta > Spor Çantası · Çanta > Makyaj Çantası · Çanta > Valiz & Bavul · Taşıma & Güvenlik > Anne Bebek Çantası |
| `AKS-CUZDAN` | 2 | Cüzdan & Kartlık > Cüzdan · Cüzdan & Kartlık > Kartlık |
| `AKS-GIYIM` | 8 | Şapka, Bere & Eldiven > Şapka · Şapka, Bere & Eldiven > Bere · Şapka, Bere & Eldiven > Eldiven · Şapka, Bere & Eldiven > Boyunluk · Atkı, Şal & Eşarp > Atkı · Atkı, Şal & Eşarp > Şal · Atkı, Şal & Eşarp > Eşarp · Kemer & Kravat > Kravat & Papyon |
| `AKS-GOZLUK` | 1 | Saat & Gözlük > Güneş Gözlüğü |
| `AKS-KEMER` | 1 | Kemer & Kravat > Kemer |
| `AKS-SAAT` | 1 | Saat & Gözlük > Kol Saati |
| `AKS-TAKI` | 6 | Takı > Kolye · Takı > Küpe · Takı > Bileklik · Takı > Yüzük · Takı > Broş · Takı > Takı Seti |
| `AYK` | 22 | Spor Ayakkabı > Antrenman Ayakkabısı · Spor Ayakkabı > Koşu Ayakkabısı · Spor Ayakkabı > Yürüyüş Ayakkabısı · Spor Ayakkabı > Basketbol Ayakkabısı · Spor Ayakkabı > Tenis Ayakkabısı · Spor Ayakkabı > Krampon · Spor Ayakkabı > Outdoor & Trekking Ayakkabısı · Sneaker & Günlük > Sneaker · Sneaker & Günlük > Günlük Ayakkabı · Sneaker & Günlük > Loafer · Sneaker & Günlük > Babet · Klasik & Topuklu > Klasik Ayakkabı · Klasik & Topuklu > Topuklu Ayakkabı · Bot & Çizme > Bot · Bot & Çizme > Çizme · Bot & Çizme > Kar Botu · Bot & Çizme > Outdoor Bot · Sandalet & Terlik > Sandalet · Sandalet & Terlik > Terlik · Sandalet & Terlik > Ev Terliği · Bebek Ayakkabısı > Bebek Patiği · Bebek Ayakkabısı > İlk Adım Ayakkabısı |
| `AYK-BAKIM` | 3 | Ayakkabı Bakım & Aksesuar > Ayakkabı Bakım Ürünleri · Ayakkabı Bakım & Aksesuar > Bağcık · Ayakkabı Bakım & Aksesuar > Tabanlık |
| `BEB-BAKIM` | 7 | Beslenme & Emzirme > Göğüs Kremi · Bebek Bakım > Islak Mendil · Bebek Bakım > Bebek Şampuanı · Bebek Bakım > Bebek Sabunu · Bebek Bakım > Bebek Yağı · Bebek Bakım > Bebek Kremi & Losyonu · Bebek Bakım > Bebek Deterjanı |
| `BEB-BESLENME` | 13 | Beslenme & Emzirme > Biberon & Emzik · Beslenme & Emzirme > Biberon Seti · Beslenme & Emzirme > Biberon Temizleyici · Beslenme & Emzirme > Sterilizatör · Beslenme & Emzirme > Buharlı Pişirici · Beslenme & Emzirme > Mama Önlüğü · Beslenme & Emzirme > Alıştırma Bardağı · Beslenme & Emzirme > Yemek Seti · Beslenme & Emzirme > Termal Çanta · Beslenme & Emzirme > Göğüs Pompası · Beslenme & Emzirme > Emzirme Önlüğü · Beslenme & Emzirme > Emzirme Minderi · Beslenme & Emzirme > Göğüs Pedi |
| `BEB-BEZ` | 1 | Bebek Bakım > Bebek Bezi |
| `BEB-EKIPMAN` | 8 | Taşıma & Güvenlik > Bebek Arabası & Puset · Taşıma & Güvenlik > Baston Puset · Taşıma & Güvenlik > Ana Kucağı · Taşıma & Güvenlik > Portbebe & Kanguru · Taşıma & Güvenlik > Yürüteç · Taşıma & Güvenlik > Park Yatak · Taşıma & Güvenlik > Bebek Salıncağı · Beslenme & Emzirme > Mama Sandalyesi |
| `BEB-ODA` | 10 | Bebek Odası > Beşik · Bebek Odası > Bebek Yatağı · Bebek Odası > Bebek Nevresimi · Bebek Odası > Bebek Battaniyesi · Bebek Odası > Cibinlik · Bebek Odası > Oyuncak Sepeti · Bebek Odası > Oyuncak Dolabı · Bebek Odası > Bebek Odası Mobilyası · Bebek Odası > Oyun Matı · Bebek Odası > Oyun Parkı |
| `BEB-OTO` | 1 | Taşıma & Güvenlik > Oto Koltuğu |
| `ELK-AKILLI-EV` | 2 | Akıllı Ev & Güvenlik > Akıllı Ev Ürünleri · Akıllı Ev & Güvenlik > Güvenlik Kamerası |
| `ELK-AKS` | 3 | Bilgisayar & Tablet > Bilgisayar Aksesuarları · Bilgisayar & Tablet > Oyuncu Ekipmanları · Foto & Kamera > Kamera Aksesuarları |
| `ELK-BAKIM-ALETI` | 5 | Kişisel Bakım Aletleri > Saç Kurutma Makinesi · Kişisel Bakım Aletleri > Saç Şekillendirme Cihazı · Kişisel Bakım Aletleri > Tıraş & Sakal Makinesi · Kişisel Bakım Aletleri > Epilatör & IPL · Kişisel Bakım Aletleri > Masaj Aleti |
| `ELK-BILGISAYAR` | 2 | Bilgisayar & Tablet > Laptop · Bilgisayar & Tablet > Masaüstü Bilgisayar |
| `ELK-CEVRE` | 3 | Bilgisayar & Tablet > Klavye & Mouse · Bilgisayar & Tablet > Veri Depolama · Bilgisayar & Tablet > Ağ & Modem |
| `ELK-EV-ALETI` | 9 | Bebek Bakım > Bebek Buhar Makinesi · Elektrikli Ev & Mutfak Aletleri > Kahve Makinesi · Elektrikli Ev & Mutfak Aletleri > Çay Makinesi · Elektrikli Ev & Mutfak Aletleri > Su Isıtıcı (Kettle) · Elektrikli Ev & Mutfak Aletleri > Blender & Mutfak Robotu · Elektrikli Ev & Mutfak Aletleri > Tost Makinesi · Elektrikli Ev & Mutfak Aletleri > Süpürge · Elektrikli Ev & Mutfak Aletleri > Ütü · Elektrikli Ev & Mutfak Aletleri > Hava Temizleyici & Nem Alma |
| `ELK-GIYILEBILIR` | 2 | Giyilebilir Teknoloji > Akıllı Saat · Giyilebilir Teknoloji > Akıllı Bileklik |
| `ELK-KAMERA` | 4 | Foto & Kamera > Fotoğraf Makinesi · Foto & Kamera > Aksiyon Kamerası · Foto & Kamera > Video Kamera · Foto & Kamera > Drone |
| `ELK-MONITOR` | 1 | Bilgisayar & Tablet > Monitör |
| `ELK-SES` | 3 | Ses & Kulaklık > Kulaklık · Ses & Kulaklık > Bluetooth Hoparlör · Ses & Kulaklık > Müzik Sistemi & Pikap |
| `ELK-TABLET` | 1 | Bilgisayar & Tablet > Tablet |
| `ELK-TEL-AKS` | 6 | Telefon Aksesuarları > Telefon Kılıfı · Telefon Aksesuarları > Ekran Koruyucu · Telefon Aksesuarları > Şarj Cihazı · Telefon Aksesuarları > Şarj Kablosu · Telefon Aksesuarları > Powerbank · Telefon Aksesuarları > Telefon Tutucu & Stand |
| `EV-AYDINLATMA` | — | Ev > Aydınlatma (tüm yapraklar) · Ofis > Aydınlatma (tüm yapraklar) |
| `EV-BAKIM` | — | Ev > Ev Bakımı (tüm yapraklar) |
| `EV-DEKOR` | — | Ev > Ev Aksesuarları (tüm yapraklar) · Ev > Ev Dekorasyon (tüm yapraklar) · Ofis > Aksesuar (tüm yapraklar) |
| `EV-MOBILYA` | — | Ev > Mobilya (tüm yapraklar) · Ofis > Mobilya (tüm yapraklar) |
| `EV-MUTFAK` | — | Ev > Mutfak & Sofra (tüm yapraklar) |
| `EV-TEKSTIL` | — | Ev > Ev Tekstili (tüm yapraklar) |
| `GIY-ALT` | 6 | Alt Giyim > Pantolon · Alt Giyim > Kot Pantolon · Alt Giyim > Şort · Alt Giyim > Etek · Alt Giyim > Tayt · Alt Giyim > Eşofman Altı |
| `GIY-DIS` | 10 | Dış Giyim > Mont · Dış Giyim > Kaban · Dış Giyim > Palto · Dış Giyim > Trençkot · Dış Giyim > Pardösü & Ferace · Dış Giyim > Yağmurluk & Rüzgarlık · Dış Giyim > Ceket · Dış Giyim > Blazer Ceket · Dış Giyim > Kot Ceket · Dış Giyim > Deri Ceket & Mont |
| `GIY-ELB` | 3 | Elbise & Tulum > Elbise · Elbise & Tulum > Abiye Elbise · Elbise & Tulum > Tulum |
| `GIY-IC` | 16 | İç Giyim & Ev Giyimi > Sütyen · İç Giyim & Ev Giyimi > Spor Sütyeni · İç Giyim & Ev Giyimi > Bralet · İç Giyim & Ev Giyimi > Büstiyer · İç Giyim & Ev Giyimi > Külot · İç Giyim & Ev Giyimi > Boxer · İç Giyim & Ev Giyimi > İç Çamaşırı Takımı · İç Giyim & Ev Giyimi > Atlet & Body · İç Giyim & Ev Giyimi > İçlik · İç Giyim & Ev Giyimi > Korse · İç Giyim & Ev Giyimi > Kombinezon · İç Giyim & Ev Giyimi > Jartiyer · İç Giyim & Ev Giyimi > Fantezi Giyim · İç Giyim & Ev Giyimi > Çorap · İç Giyim & Ev Giyimi > Pijama Takımı · İç Giyim & Ev Giyimi > Gecelik |
| `GIY-MAYO` | 4 | Mayo & Plaj > Mayo · Mayo & Plaj > Bikini · Mayo & Plaj > Deniz Şortu · Mayo & Plaj > Plaj Elbisesi & Pareo |
| `GIY-TAK` | 4 | Takım & Set > Takım Elbise · Takım & Set > Eşofman Takımı · Takım & Set > Alt Üst Takım · Takım & Set > Hastane Çıkışı Seti |
| `GIY-UST` | 11 | Üst Giyim > Tişört · Üst Giyim > Gömlek · Üst Giyim > Bluz · Üst Giyim > Tunik · Üst Giyim > Sweatshirt · Üst Giyim > Hırka · Üst Giyim > Kazak · Üst Giyim > Polar · Üst Giyim > Yelek · Üst Giyim > Forma · Üst Giyim > Body & Zıbın |
| `KOZ-ARAC` | 6 | Makyaj > Makyaj Fırçası & Aksesuarı · Saç Bakımı > Saç Fırçası & Tarak · El, Ayak & Tırnak Bakımı > Manikür & Pedikür · Ağız & Diş Bakımı > Diş Fırçası · Ağız & Diş Bakımı > Diş İpi · Tıraş & Erkek Bakımı > Tıraş Bıçağı |
| `KOZ-BAKIM` | 16 | Cilt Bakımı > Yüz Nemlendirici · Cilt Bakımı > Yüz Temizleyici & Tonik · Cilt Bakımı > Serum & Yüz Yağı · Cilt Bakımı > Yüz Maskesi & Peeling · Cilt Bakımı > Göz Bakımı · Cilt Bakımı > Dudak Bakımı · Cilt Bakımı > Vücut Bakımı · Cilt Bakımı > Güneş Ürünleri · Saç Bakımı > Şampuan · Saç Bakımı > Saç Kremi · Saç Bakımı > Saç Maskesi & Bakım Yağı · Saç Bakımı > Saç Şekillendirici · Saç Bakımı > Saç Boyası · Saç Bakımı > Kuru Şampuan · El, Ayak & Tırnak Bakımı > El Kremi · El, Ayak & Tırnak Bakımı > Ayak Bakımı |
| `KOZ-KISISEL` | 15 | Parfüm & Deodorant > Deodorant · Banyo & Duş > Duş Jeli & Kremi · Banyo & Duş > Katı & Sıvı Sabun · Ağız & Diş Bakımı > Diş Macunu · Ağız & Diş Bakımı > Ağız Gargarası · Tıraş & Erkek Bakımı > Tıraş Köpüğü & Jeli · Tıraş & Erkek Bakımı > Tıraş Sonrası · Tıraş & Erkek Bakımı > Sakal Bakımı · Epilasyon & Ağda > Ağda · Epilasyon & Ağda > Tüy Dökücü Krem · Kadın Hijyen > Hijyenik Ped · Kadın Hijyen > Günlük Ped · Kadın Hijyen > Tampon · Cinsel Sağlık > Prezervatif · Cinsel Sağlık > Kayganlaştırıcı |
| `KOZ-MAKYAJ` | 15 | Makyaj > Fondöten · Makyaj > Kapatıcı · Makyaj > Pudra · Makyaj > BB & CC Krem · Makyaj > Allık & Bronzer · Makyaj > Aydınlatıcı & Highlighter · Makyaj > Makyaj Bazı & Sabitleyici · Makyaj > Göz Farı · Makyaj > Maskara · Makyaj > Eyeliner & Göz Kalemi · Makyaj > Kaş Makyajı · Makyaj > Ruj · Makyaj > Dudak Kalemi & Parlatıcı · Makyaj > Oje & Tırnak Makyajı · Makyaj > Makyaj Temizleyici |
| `KOZ-PARFUM` | 2 | Parfüm & Deodorant > Parfüm · Parfüm & Deodorant > Kolonya |
| `KOZ-SET` | 2 | Makyaj > Makyaj Seti · Cilt Bakımı > Cilt Bakım Seti |
| `OYUNCAK` | 7 | Oyuncak > Eğitici Oyuncak · Oyuncak > Bebek & Okul Öncesi Oyuncak · Oyuncak > Oyuncak Araba · Oyuncak > Oyuncak Bebek · Oyuncak > Kumandalı Oyuncak · Oyuncak > Robot Oyuncak · Oyuncak > Çocuk Çizim Tableti |
| `SPR-BISIKLET` | 4 | Bisiklet & Scooter > Bisiklet · Bisiklet & Scooter > Scooter · Bisiklet & Scooter > Paten & Kaykay · Bisiklet & Scooter > Bisiklet & Scooter Aksesuarları |
| `SPR-EKIPMAN` | 10 | Fitness & Kondisyon > Yoga & Pilates Matı · Fitness & Kondisyon > Ağırlık & Dambıl · Fitness & Kondisyon > Direnç Bandı · Fitness & Kondisyon > Spor Aksesuarları · Takım & Raket Sporları > Top · Takım & Raket Sporları > Raket · Takım & Raket Sporları > Koruyucu Ekipman · Doğa Sporları > Dağcılık & Tırmanış · Doğa Sporları > Kayak & Kar Sporları · Doğa Sporları > Dalış & Su Sporları |
| `SPR-KAMP` | 6 | Kamp & Outdoor > Çadır · Kamp & Outdoor > Uyku Tulumu · Kamp & Outdoor > Kamp Mobilyası · Kamp & Outdoor > Kamp Mutfağı & Termos · Kamp & Outdoor > Fener & Kamp Aydınlatması · Kamp & Outdoor > Outdoor Ekipmanları |
