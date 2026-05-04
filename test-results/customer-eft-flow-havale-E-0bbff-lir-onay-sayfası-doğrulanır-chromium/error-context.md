# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customer-eft-flow.spec.ts >> havale/EFT ile sipariş tamamlanır; sözleşmeler kaydedilir; onay sayfası doğrulanır
- Location: tests\e2e\customer-eft-flow.spec.ts:211:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: locator('button').filter({ hasText: /Siparisi Onayla/i })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for locator('button').filter({ hasText: /Siparisi Onayla/i })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e4]:
      - link "Hanuja — Ana Sayfa" [ref=e5] [cursor=pointer]:
        - /url: /
        - generic "Hanuja" [ref=e6]:
          - img [ref=e7]
          - generic [ref=e13]:
            - generic [ref=e14]: hanuja
            - generic [ref=e15]: curated living
      - generic [ref=e17]:
        - img [ref=e18]
        - searchbox "Ürün, mağaza veya kategori ara" [ref=e21]
      - generic [ref=e22]:
        - link "Hesabım" [ref=e23] [cursor=pointer]:
          - /url: /hesabim
          - img [ref=e24]
        - link "Sepet (4 ürün)" [ref=e27] [cursor=pointer]:
          - /url: /sepet
          - img [ref=e28]
          - generic "4 ürün" [ref=e32]: "4"
    - navigation "Kategoriler" [ref=e34]:
      - menubar [ref=e36]:
        - menuitem "Ev" [ref=e38] [cursor=pointer]:
          - text: Ev
          - img [ref=e39]
        - menuitem "Ofis" [ref=e42] [cursor=pointer]:
          - text: Ofis
          - img [ref=e43]
        - menuitem "Mobilya" [ref=e46] [cursor=pointer]:
          - text: Mobilya
          - img [ref=e47]
        - menuitem "Mutfak & Sofra" [ref=e50] [cursor=pointer]:
          - text: Mutfak & Sofra
          - img [ref=e51]
        - menuitem "Aydınlatma" [ref=e54] [cursor=pointer]:
          - text: Aydınlatma
          - img [ref=e55]
        - menuitem "Dekorasyon" [ref=e58] [cursor=pointer]:
          - text: Dekorasyon
          - img [ref=e59]
        - menuitem "Aksesuar" [ref=e62] [cursor=pointer]:
          - text: Aksesuar
          - img [ref=e63]
        - menuitem "Tekstil" [ref=e66] [cursor=pointer]:
          - text: Tekstil
          - img [ref=e67]
  - main [ref=e69]:
    - generic [ref=e70]:
      - heading "Ödeme" [level=1] [ref=e71]
      - generic [ref=e72]:
        - generic [ref=e73]:
          - generic [ref=e74]:
            - generic [ref=e75]:
              - img [ref=e76]
              - heading "Teslimat Adresi" [level=2] [ref=e79]
            - generic [ref=e81] [cursor=pointer]:
              - radio "Playwright Müşteri Playwright Mahallesi, Test Sokak No:1 Kadıköy / İstanbul 34000 05001234567" [checked] [ref=e82]
              - generic [ref=e83]:
                - generic [ref=e85]: Playwright Müşteri
                - paragraph [ref=e86]: Playwright Mahallesi, Test Sokak No:1
                - paragraph [ref=e87]: Kadıköy / İstanbul 34000
                - paragraph [ref=e88]: "05001234567"
              - img [ref=e89]
            - button "Yeni adres ekle" [ref=e92] [cursor=pointer]:
              - img [ref=e93]
              - text: Yeni adres ekle
          - generic [ref=e94]:
            - generic [ref=e95]:
              - img [ref=e96]
              - heading "Ödeme Yöntemi" [level=2] [ref=e98]
            - generic [ref=e99]:
              - generic [ref=e100] [cursor=pointer]:
                - radio "Kredi / Banka Kartı Güvenli ödeme - Iyzico altyapısı" [ref=e101]
                - img [ref=e102]
                - generic [ref=e104]:
                  - paragraph [ref=e105]: Kredi / Banka Kartı
                  - paragraph [ref=e106]: Güvenli ödeme - Iyzico altyapısı
              - generic [ref=e107] [cursor=pointer]:
                - radio "Havale / EFT Siparis sonrasinda banka bilgileri gosterilir" [checked] [ref=e108]
                - img [ref=e109]
                - generic [ref=e112]:
                  - paragraph [ref=e113]: Havale / EFT
                  - paragraph [ref=e114]: Siparis sonrasinda banka bilgileri gosterilir
        - generic [ref=e115]:
          - heading "Sipariş Özeti" [level=2] [ref=e116]
          - generic [ref=e117]:
            - generic [ref=e118]:
              - generic [ref=e119]: 4 urun
              - generic [ref=e120]: ₺30.700,00
            - generic [ref=e121]:
              - generic [ref=e122]: Kargo
              - generic [ref=e123]: Ucretsiz
            - generic [ref=e124]:
              - generic [ref=e125]: Toplam
              - generic [ref=e126]: ₺30.700,00
          - generic [ref=e127]:
            - generic [ref=e128]:
              - checkbox [checked] [ref=e129]
              - generic [ref=e130]:
                - button "Mesafeli Satış Sözleşmesi" [ref=e131] [cursor=pointer]
                - text: metnini okudum, kabul ediyorum.
            - generic [ref=e132]:
              - checkbox [checked] [active] [ref=e133]
              - generic [ref=e134]:
                - button "Ön Bilgilendirme Formu" [ref=e135] [cursor=pointer]
                - text: metnini okudum, kabul ediyorum.
          - generic [ref=e136]:
            - paragraph [ref=e137]: İnsan doğrulaması
            - generic [ref=e138]: Turnstile anahtari tanimli degil. Gelistirme modunda otomatik bypass kullaniliyor.
            - paragraph [ref=e139]: Siparisi onaylamak icin bu adim zorunludur.
          - button "Siparişi Onayla" [ref=e140] [cursor=pointer]
  - contentinfo [ref=e141]:
    - generic [ref=e142]:
      - generic [ref=e143]:
        - generic [ref=e144]:
          - generic "Hanuja" [ref=e145]:
            - img [ref=e146]
            - generic [ref=e152]:
              - generic [ref=e153]: hanuja
              - generic [ref=e154]: curated living
          - paragraph [ref=e155]: Ev, ofis ve yaşam ürünlerinde seçkin mağazalar.
        - generic [ref=e156]:
          - paragraph [ref=e157]: Alışveriş
          - list [ref=e158]:
            - listitem [ref=e159]:
              - link "Mobilya" [ref=e160] [cursor=pointer]:
                - /url: /kategori/mobilya
            - listitem [ref=e161]:
              - link "Aydınlatma" [ref=e162] [cursor=pointer]:
                - /url: /kategori/aydinlatma
            - listitem [ref=e163]:
              - link "Dekorasyon" [ref=e164] [cursor=pointer]:
                - /url: /kategori/ev-dekorasyon
            - listitem [ref=e165]:
              - link "Blog & İlham" [ref=e166] [cursor=pointer]:
                - /url: /blog
        - generic [ref=e167]:
          - paragraph [ref=e168]: Yardım
          - list [ref=e169]:
            - listitem [ref=e170]:
              - link "Siparişlerim" [ref=e171] [cursor=pointer]:
                - /url: /siparis
            - listitem [ref=e172]:
              - link "Hesabım" [ref=e173] [cursor=pointer]:
                - /url: /hesabim
            - listitem [ref=e174]:
              - link "İade & Değişim" [ref=e175] [cursor=pointer]:
                - /url: /iade-iptal
            - listitem [ref=e176]:
              - link "Ön Bilgilendirme" [ref=e177] [cursor=pointer]:
                - /url: /on-bilgilendirme
            - listitem [ref=e178]:
              - link "İletişim" [ref=e179] [cursor=pointer]:
                - /url: /iletisim
        - generic [ref=e180]:
          - paragraph [ref=e181]: Satıcılar
          - list [ref=e182]:
            - listitem [ref=e183]:
              - link "Mağaza Aç" [ref=e184] [cursor=pointer]:
                - /url: https://seller.hanuja.com.tr/basvuru
            - listitem [ref=e185]:
              - link "Satıcı Kuralları" [ref=e186] [cursor=pointer]:
                - /url: /kullanim-kosullari
      - generic [ref=e187]:
        - generic [ref=e188]:
          - generic [ref=e189]: Visa
          - generic [ref=e190]: Mastercard
          - generic [ref=e191]: Troy
          - generic [ref=e192]: Amex
          - generic [ref=e193]:
            - img [ref=e194]
            - text: SSL Güvenli
        - paragraph [ref=e197]: Tüm ödemeler Iyzico altyapısı ile güvenle işlenir.
      - generic [ref=e198]:
        - paragraph [ref=e199]: © 2026 Hanuja Dijital. Tüm hakları saklıdır.
        - generic [ref=e200]:
          - link "Gizlilik Politikası" [ref=e201] [cursor=pointer]:
            - /url: /gizlilik-politikasi
          - link "Kullanım Koşulları" [ref=e202] [cursor=pointer]:
            - /url: /kullanim-kosullari
          - link "KVKK" [ref=e203] [cursor=pointer]:
            - /url: /kvkk
          - link "Mesafeli Satış Sözleşmesi" [ref=e204] [cursor=pointer]:
            - /url: /mesafeli-satis
          - link "Ön Bilgilendirme Formu" [ref=e205] [cursor=pointer]:
            - /url: /on-bilgilendirme
          - link "İade & İptal" [ref=e206] [cursor=pointer]:
            - /url: /iade-iptal
  - region "Notifications (F8)":
    - list
  - button "Open Next.js Dev Tools" [ref=e212] [cursor=pointer]:
    - img [ref=e213]
  - alert [ref=e216]
```

# Test source

```ts
  163 |   expect(res?.status()).toBe(200)
  164 |   await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  165 | 
  166 |   // Kategori listesine git
  167 |   await page.goto(`${BASE_URL}/kategori`)
  168 |   const catLink = page.locator('a[href*="/kategori/"]').first()
  169 |   await expect(catLink).toBeVisible({ timeout: 5000 })
  170 |   await catLink.click()
  171 |   await page.waitForLoadState('networkidle')
  172 | 
  173 |   // Ürün linki görünmeli
  174 |   const productLink = page.locator('a[href*="/urun/"]').first()
  175 |   await expect(productLink).toBeVisible({ timeout: 8000 })
  176 | 
  177 |   // Ürün detayına gir
  178 |   await productLink.click()
  179 |   await page.waitForLoadState('networkidle')
  180 |   await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  181 | })
  182 | 
  183 | // ═══════════════════════════════════════════════════════════════════
  184 | // TEST 5: Sepet
  185 | // ═══════════════════════════════════════════════════════════════════
  186 | test('ürün sepete eklenir; sepet sayfası yüklenir', async ({ page }) => {
  187 |   await loginCustomer(page)
  188 | 
  189 |   // Ürün bul
  190 |   await page.goto(`${BASE_URL}/kategori`)
  191 |   await page.locator('a[href*="/kategori/"]').first().click()
  192 |   await page.waitForLoadState('networkidle')
  193 |   await page.locator('a[href*="/urun/"]').first().click()
  194 |   await page.waitForLoadState('networkidle')
  195 | 
  196 |   // Sepete ekle
  197 |   const addBtn = page.locator('button').filter({ hasText: /Sepete Ekle/i })
  198 |   await expect(addBtn.first()).toBeVisible({ timeout: 5000 })
  199 |   await addBtn.first().click()
  200 |   await page.waitForTimeout(600)
  201 | 
  202 |   // Sepet sayfasını kontrol et
  203 |   await page.goto(`${BASE_URL}/sepet`)
  204 |   await page.waitForLoadState('networkidle')
  205 |   await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  206 | })
  207 | 
  208 | // ═══════════════════════════════════════════════════════════════════
  209 | // TEST 6: EFT / Havale ile sipariş — ANA TEST
  210 | // ═══════════════════════════════════════════════════════════════════
  211 | test('havale/EFT ile sipariş tamamlanır; sözleşmeler kaydedilir; onay sayfası doğrulanır', async ({
  212 |   page,
  213 | }) => {
  214 |   // Giriş (mockTurnstile zaten içinde)
  215 |   await loginCustomer(page)
  216 | 
  217 |   // ── Ürün bul ve sepete ekle ─────────────────────────────────────
  218 |   await page.goto(`${BASE_URL}/kategori`)
  219 |   await page.locator('a[href*="/kategori/"]').first().click()
  220 |   await page.waitForLoadState('networkidle')
  221 |   await page.locator('a[href*="/urun/"]').first().click()
  222 |   await page.waitForLoadState('networkidle')
  223 | 
  224 |   const addBtn = page.locator('button').filter({ hasText: /Sepete Ekle/i })
  225 |   await expect(addBtn.first()).toBeVisible({ timeout: 5000 })
  226 |   await addBtn.first().click()
  227 |   await page.waitForTimeout(600)
  228 | 
  229 |   // ── Ödeme sayfasına git ──────────────────────────────────────────
  230 |   await page.goto(`${BASE_URL}/odeme`)
  231 |   await page.waitForLoadState('networkidle')
  232 | 
  233 |   // ── Teslimat adresi seç ──────────────────────────────────────────
  234 |   const addressRadio = page.locator('input[name="address"]').first()
  235 |   await expect(addressRadio).toBeVisible({ timeout: 8000 })
  236 |   if (!(await addressRadio.isChecked())) {
  237 |     await addressRadio.check()
  238 |   }
  239 | 
  240 |   // ── Ödeme yöntemi: Havale/EFT ────────────────────────────────────
  241 |   const eftRadio = page.locator('input[name="payment"][value="eft"]')
  242 |   await expect(eftRadio).toBeVisible({ timeout: 5000 })
  243 |   await eftRadio.check()
  244 | 
  245 |   // ── Sözleşmelerin hazır olmasını bekle (checkbox'lar enabled olur) ─
  246 |   const checkboxes = page.locator('input[type="checkbox"]')
  247 |   await expect(checkboxes.first()).toBeEnabled({ timeout: 15000 })
  248 |   await expect(checkboxes).toHaveCount(2)
  249 | 
  250 |   // ── İki sözleşmeyi onayla ────────────────────────────────────────
  251 |   await checkboxes.nth(0).check()
  252 |   await checkboxes.nth(1).check()
  253 | 
  254 |   // Sözleşmelerin işaretlendiğini doğrula
  255 |   await expect(checkboxes.nth(0)).toBeChecked()
  256 |   await expect(checkboxes.nth(1)).toBeChecked()
  257 | 
  258 |   // ── Turnstile mock token bekle (60ms'de geliyor) ─────────────────
  259 |   await page.waitForTimeout(200)
  260 | 
  261 |   // ── Sipariş onayla butonu aktif ve tıklanabilir ──────────────────
  262 |   const submitBtn = page.locator('button').filter({ hasText: /Siparisi Onayla/i })
> 263 |   await expect(submitBtn).toBeEnabled({ timeout: 5000 })
      |                           ^ Error: expect(locator).toBeEnabled() failed
  264 |   await submitBtn.click()
  265 | 
  266 |   // ── Sipariş onay sayfasına yönlenme ─────────────────────────────
  267 |   await page.waitForURL(/\/siparis\//, { timeout: 20000 })
  268 |   const orderUrl = page.url()
  269 |   expect(orderUrl).toMatch(/\/siparis\/[a-z0-9]+/)
  270 | 
  271 |   // ── Sipariş onay sayfası doğrulamaları ───────────────────────────
  272 | 
  273 |   // 1. Sayfa yüklendi
  274 |   await page.waitForLoadState('networkidle')
  275 | 
  276 |   // 2. Sipariş numarası / başlık
  277 |   await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  278 | 
  279 |   // 3. Durum rozeti: havale bekleniyor
  280 |   await expect(
  281 |     page
  282 |       .locator(
  283 |         '[class*="badge"], [class*="status"], [class*="Badge"], [class*="Status"], span, div',
  284 |       )
  285 |       .filter({ hasText: /Havale|EFT|Bekleniyor|bank_transfer/i })
  286 |       .first(),
  287 |   ).toBeVisible({ timeout: 8000 })
  288 | 
  289 |   // 4. Mesafeli Satış ve Ön Bilgilendirme sözleşme butonları görünmeli
  290 |   const mesafeliBtn = page.locator('button').filter({ hasText: /Mesafeli/i })
  291 |   const onBilBtn = page.locator('button').filter({ hasText: /Bilgilendirme/i })
  292 |   await expect(mesafeliBtn.first()).toBeVisible({ timeout: 5000 })
  293 |   await expect(onBilBtn.first()).toBeVisible({ timeout: 5000 })
  294 | 
  295 |   // 5. Ürün kalemi görünmeli
  296 |   await expect(page.locator('img, [class*="product"], [class*="item"]').first()).toBeVisible({
  297 |     timeout: 5000,
  298 |   })
  299 | })
  300 | 
  301 | // ═══════════════════════════════════════════════════════════════════
  302 | // TEST 7: Hesabım profil & adres sayfaları
  303 | // ═══════════════════════════════════════════════════════════════════
  304 | test('hesabım profil ve adres sayfaları yüklenir', async ({ page }) => {
  305 |   await loginCustomer(page)
  306 | 
  307 |   // Profil — sayfanın yüklenip içerik göstermesini bekle
  308 |   await expect(page).toHaveURL(/hesabim/)
  309 |   await page.waitForLoadState('networkidle')
  310 |   await expect(page.locator('h1, h2, [class*="heading"], nav a').first()).toBeVisible({ timeout: 10000 })
  311 | 
  312 |   // Adres sayfası
  313 |   await page.goto(`${BASE_URL}/hesabim/adresler`)
  314 |   await page.waitForLoadState('networkidle')
  315 |   await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  316 |   // Test müşterisinin adresi gösterilmeli
  317 |   await expect(page.getByText(/Playwright Mahallesi/i)).toBeVisible({ timeout: 5000 })
  318 |   await expect(page.getByText('05001234567')).toBeVisible()
  319 | })
  320 | 
  321 | // ═══════════════════════════════════════════════════════════════════
  322 | // TEST 8: Sipariş listesi
  323 | // ═══════════════════════════════════════════════════════════════════
  324 | test('sipariş listesinde en az bir sipariş ve detay linki görünür', async ({ page }) => {
  325 |   await loginCustomer(page)
  326 | 
  327 |   await page.goto(`${BASE_URL}/siparis`)
  328 |   await page.waitForLoadState('networkidle')
  329 |   await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 5000 })
  330 | 
  331 |   // Test 6'da sipariş verildi; en az bir sipariş linki olmalı
  332 |   const orderLinks = page.locator('a[href*="/siparis/"]')
  333 |   await expect(orderLinks.first()).toBeVisible({ timeout: 8000 })
  334 | })
  335 | 
```