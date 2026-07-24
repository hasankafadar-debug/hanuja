# Seller Panel Rules

## Purpose

This file defines the non-negotiable rules for the Hanuja seller panel.

It exists to keep seller-facing behavior consistent across:

- product management
- inventory and pricing
- order handling
- shipment and tracking actions
- payout visibility
- penalty visibility
- finance summaries
- return/dispute participation
- seller account and payout settings

If implementation conflicts with this file, this file wins unless a newer approved business, finance, or security decision replaces it.

## Core Seller Panel Principle

The seller panel is not a full marketplace control surface.

It is a controlled operational workspace for the seller.

The seller panel must let the seller:

- manage their own products
- fulfill valid orders
- enter shipment and tracking information
- see finance outcomes that affect them
- understand deductions, penalties, and payout timing
- respond to returns/disputes where policy allows

The seller panel must **not** let the seller:

- bypass payment confirmation rules
- rewrite payout eligibility
- hide penalty history
- access admin-only risk reasoning
- see other sellers’ data
- override platform lifecycle rules

## Seller Panel Priority Order

When seller panel decisions conflict, prioritize in this order:

1. finance correctness
2. lifecycle correctness
3. security and data isolation
4. operational clarity
5. seller usability
6. visual polish

Never improve convenience by weakening payout, payment, or audit rules.

## Seller Scope Rules

The seller can only access their own data.

The seller panel must be scoped to the authenticated seller identity and must never expose:

- other sellers’ catalog data
- other sellers’ orders
- platform-wide finance totals
- admin-only notes
- internal fraud logic details
- hidden moderation comments unless explicitly allowed
- raw internal adjustment reasoning beyond seller-safe explanations

All seller-facing queries must be ownership-checked on the server.

## Seller Dashboard Expectations

The seller dashboard should quickly answer:

- How many actionable orders do I have?
- Which orders are delayed?
- Which products need attention?
- What amount is pending?
- What amount is on hold?
- What amount is payout-ready?
- What penalties or deductions affect me?
- Are there returns/disputes needing response?

At minimum, the seller dashboard should surface:

- new paid orders
- preparing / awaiting shipment orders
- delayed orders
- hold-period earnings
- payout-ready earnings
- paid earnings
- recent penalties
- recent deductions
- return/dispute items requiring attention
- important account/configuration alerts

## Order Visibility Rules

Seller must only see orders after payment confirmation.

The seller panel must not expose unpaid or unverified orders as fulfillable work.

### Seller-visible order conditions

Orders become visible/actionable to seller only after payment is confirmed according to platform rules.

Do not show these as active seller orders:

- payment pending
- payment failed
- bank transfer waiting
- unverified payment
- abandoned checkout

### Seller view expectations

For each seller-visible order, show at minimum:

- order number/reference
- product lines belonging to that seller
- quantity
- customer delivery information as allowed
- order state
- shipment/tracking state
- delay/risk-to-fulfillment indicator
- finance relevance where appropriate

## Seller Order Action Rules

Seller panel should support only legitimate seller actions.

### Typical seller actions

- view order details
- accept/continue fulfillment
- reject order with reason when policy allows
- mark preparation progress
- enter shipment/tracking details
- view delivery progression
- respond to return/dispute requests where allowed

### Seller must not be able to

- manually mark payment confirmed
- mark payout-ready
- waive their own penalty
- directly change payout hold state
- close disputes unilaterally
- rewrite order history
- mark finance adjustments as resolved

## Seller Rejection Rules

Seller rejection is a controlled exception, not a casual workflow.

If seller rejects an order:

- rejection reason must be mandatory
- rejection must be timestamped
- admin must be able to review it
- seller must understand that rejection can trigger penalty consequences
- seller must not be able to hide or delete the rejection history

### Seller rejection UX rule

The interface must make rejection seriousness clear.

Good UX should include:

- visible warning text
- mandatory reason selection
- clear note that rejection may lead to penalty
- confirmation before final submission

Do not design rejection like a harmless quick dismiss action.

## Shipment and Tracking Rules

The seller panel must support shipment creation/tracking entry clearly and safely.

### Shipment expectations

Seller should be able to:

- enter tracking code
- choose shipment/cargo option if applicable
- update shipment-related details where policy allows
- view shipment timeline/status

### Shipment rules

1. Tracking updates must be linked to the order.
2. Tracking entries must be timestamped.
3. Shipment actions must be auditable.
4. Shipment after long delay should surface admin/delay signals where relevant.
5. Once shipment begins, the lifecycle should move toward delivery/return logic, not naive cancellation logic.

### Seller must not do

- fake completion without shipment evidence
- overwrite shipment history silently
- mark delivery confirmed unless policy explicitly allows a seller-side event that still requires platform logic

## Delivery Visibility Rules

Seller should be able to see delivery progression relevant to fulfillment and payout timing.

Seller-facing delivery visibility may include:

- shipped
- delivered
- delivery confirmation pending
- delivery confirmed

### Important rule

Seller may see the difference between `delivered` and `delivery_confirmed`, but must not be allowed to redefine it.

The panel should help the seller understand:

- delivered does not mean payout countdown has fully matured
- payout hold starts from `delivery_confirmed`
- returns/disputes may still affect final payout eligibility

## Finance Summary Rules

Seller panel must present finance information clearly and honestly.

A single vague “wallet balance” is not enough.

### Seller finance visibility should include

- pending earnings
- on-hold earnings
- payout-ready earnings
- paid earnings
- commission deductions
- cargo deductions
- ad/service fee deductions
- penalty deductions
- refund-related offsets
- negative balance
- manual adjustment summaries where seller-safe
- estimated payout timing where appropriate

### Finance explanation rule

Seller must be able to understand why a number changed.

Do not show opaque totals without explanation.

## Payout Visibility Rules

Seller should have visibility into payout lifecycle, but not control over payout decisions.

### Seller should be able to see

- which orders are still in hold period
- which orders are blocked
- why payout is not yet ready at a seller-safe explanation level
- which amounts are payout-ready
- which payouts have already been paid
- payout dates or expected payout windows where available

### Seller should not be able to do

- release own payout
- remove hold state
- override blocked reasons
- mark payout as paid
- alter ledger calculations

## Penalty Visibility Rules

Seller must be able to see penalty consequences that affect them.

### Penalty visibility should include

- order reference
- product reference
- penalty amount
- penalty reason
- penalty date
- current penalty state
- whether it affected payout/negative balance
- appeal or support path if provided by platform

### Rules

- penalty history must not disappear
- waived/reversed penalties may remain visible as historical entries with updated state
- seller should not see internal-only decision notes beyond the intended seller-safe explanation

## Negative Balance Rules

Seller panel must support visible negative balance when it exists.

### Seller should see

- current negative balance total
- contributing reasons at a meaningful level
- whether future payouts will offset it
- history of major related entries

Do not hide negative balances and then surprise the seller at payout time.

## Product Management Rules

Seller panel must support controlled product management.

### Seller product actions may include

- create product draft
- edit own product
- upload images
- manage inventory
- manage pricing
- submit or update content
- view product moderation state where allowed

### Product rules

- seller can only manage own products
- platform-required fields must be validated
- prohibited or invalid content must be blockable
- moderation status should be visible where relevant
- hidden/unlisted/rejected states should be understandable
- a product may only be attached to a **leaf category** (see below)

Seller should not be able to bypass mandatory product quality or moderation rules.

### Kategori seçimi: yalnız yaprak kategori

Ürün yalnızca **yaprak kategoriye** bağlanabilir — yani aktif alt kategorisi olmayan kategoriye.
Ara kategoriler (`Ev`, `Ev > Mobilya`) yalnızca gruplama ve navigasyon içindir; ürün taşımazlar.
Yalnız pasif alt kategorisi olan bir kategori yaprak sayılır (emekliye ayrılmış dallar satıcıyı
engellememelidir).

Kural tek kaynaktan, domain katmanında uygulanır (`api/domain/category-selection.ts` →
`assertLeafCategory`) ve `catalog.service.ts` içindeki `createProduct` / `updateProductForSeller`
üzerinden **tüm** ürün oluşturma yollarını kapsar: satıcı ürün formu, toplu (Excel) yükleme ve
Hipicon URL importu. Route katmanında ayrıca doğrulama yapılmaz.

Satıcı arayüzü buna uygun olmalıdır:

- Ürün ekleme/düzenleme formunda kategori **kademeli** seçilir (seviye başına bir liste: önce
  `Ev`/`Ofis`, sonra alt kategori, sonra onun altı). Yaprağa inilmeden kategori seçilmiş sayılmaz ve
  form gönderilemez.
- **Toplu (Excel) yüklemede kapsam yaprağa kadar zorunludur.** Satıcı kademeli seçimi son (yaprak)
  kategoriye indirmeden şablon indirilemez ve dosya yüklenemez; ara kategoride durulursa indir/yükle
  butonları pasif kalır. İndirilen şablon yalnızca seçilen **tek** yaprak kategoriyi içerir (eski
  "üst seviyede durup tüm alt dalları tek dosyaya alma" davranışı kaldırıldı). Sunucu, ara kategoriyle
  gelen şablon/yükleme isteğini `En alt kategoriyi seçmelisiniz.` hatasıyla reddeder
  (`bulk/template` ve `bulk` route'ları `findBulkCategoryReferenceRowBySlug` ile yaprak doğrular).
- Hipicon import önizlemesi yalnız yaprak kategorileri önerir; kategori eşleşmesi yaprağa inmiyorsa
  `too_shallow` ile reddedilir.
- Satıcılar kendileri kategori oluşturamaz. Toplu yükleme, tekli ürün ekleme/düzenleme ve URL
  import kategori alanlarında, aranan alt kategori yoksa satıcıyı `/destek`'e yönlendiren bir mesaj
  gösterilir (paylaşılan `CategorySupportHint` bileşeni). Yeni kategori talepleri mevcut destek
  bileti sistemi üzerinden yönetilir; ayrı bir kategori talep modülü yoktur.

Bu kural değişirse `api/domain/category-selection.ts`, seller panel kategori seçici, toplu yükleme
formu/şablonu (`bulk-import-form.tsx`, `bulk/{template,route}.ts`), import çözümleyicisi ve
`CategorySupportHint` birlikte gözden geçirilmelidir.

Hipicon mağaza URL importu satıcı panelde `/urunler/ice-aktar` altında kalır ve yalnızca oturumdaki aktif satıcının kendi kataloğuna ürün ekleyebilir.

### Renk seçimi: tek/çift renk + Mix

Renk seçenekleri DB-seed'li `ProductAttributeOption` tablosundan gelir (tek geniş ortak palet;
kategoriye özel kısıt yoktur). Palet **küratörlü sırada** gösterilir — sıra `ProductAttributeOption.sortOrder`
ile gelir (`sortAttributeOptions` bunu birincil anahtar kullanır), alfabetik değildir.

- **Tekli ürün formu:** "Renk Adedi" seçici (1/2). Adet 2 ise **Renk 1** ve **Renk 2** ayrı seçilir;
  Renk 2 zorunludur ve Renk 1'den farklı olmalıdır. 2'den fazla renk için satıcı adedi 1 tutup **Mix**
  seçer. Mağazada iki renk `"Renk: Renk1 - Renk2"` olarak gösterilir.
- **Toplu (Excel) yükleme:** `Renk 1` (zorunlu) ve `Renk 2` (opsiyonel) sütunları. Renk 2 boş olabilir
  (ürün tek renkli olabilir). Renk 2 sütun notu: "Ürün iki renkli ise ikinci rengi buradan seçin; ikiden
  fazla renk varsa Renk 1'de Mix seçin". Eski `Urun Rengi*` başlıklı şablonlar geriye dönük kabul edilir.
- **Depolama:** iki renk `ProductAttributeValue` join'inde `sortOrder` ile ayrılır (Renk 1 → 0, Renk 2 → 1).

Bu kural değişirse tekli form (`new-product-form.tsx` / `product-edit-form.tsx`), toplu yükleme
(`bulk-product-import.ts`, `bulk/{template,route}.ts`), create/edit route'ları ve storefront ürün sayfası
birlikte gözden geçirilmelidir. (URL importu bu turda kapsam dışı — tek renk yazar.)

### Ürün ölçüleri (En / Boy / Yükseklik)

Ölçüler opsiyoneldir ve her yükleme yolunda (tekli form + Excel) girilebilir. Eşleme:
**En → `dimensionWidth`, Boy → `dimensionLength`, Yükseklik → `dimensionHeight`** (cm). Girilirse ürün
detay sayfasında stok/sevk satırının yanında ayrı etiketlerle gösterilir ("En: 100 cm · Boy: 30 cm ·
Yükseklik: 45 cm"); girilmezse hiç gösterilmez (satıcı kısa açıklamaya yazmış olabilir). Zorunlu değildir.

## Pricing and Inventory Rules

Seller pricing and inventory actions affect catalog quality and fulfillment reliability.

### Rules

- updates must apply only to seller-owned products
- invalid pricing input must be blocked
- stock changes must be auditable enough for operations
- if inventory affects order acceptance/rejection risk, platform should be able to review historical patterns

Do not design pricing/inventory updates as untraceable silent edits.

## Returns and Disputes in Seller Panel

Seller may need to participate in return/dispute flows, but not control them unilaterally.

### Seller should be able to

- see return/dispute opened against relevant orders
- read customer-facing reason/context where appropriate
- submit response or evidence
- see current status
- know whether payout is affected

### Seller should not be able to

- close return alone
- issue platform refund alone unless explicitly designed and approved
- remove dispute evidence
- suppress the case from history

## Seller Account and Settings Rules

Seller panel may contain account and business settings, but sensitive changes require care.

### Sensitive settings may include

- payout/bank details
- company/legal identity info
- tax/invoice information
- support contact data
- store slug/display name
- public store profile fields

### Rules for sensitive settings

- important changes must be validated
- bank detail changes must follow security rules
- some changes may require review or delayed effect
- history should exist for critical finance-related fields

## Seller Storefront/Profile Rules

If seller has a public store page:

- seller should manage only approved public-facing fields
- public store identity should stay aligned with slug/SEO rules
- major slug-affecting changes must not happen casually
- SEO-sensitive public changes should not bypass platform rules

If store slug changes are ever allowed, redirect/canonical implications must be reviewed.

## Seller Support and Communication Rules

Seller panel should make operational problems understandable.

Where relevant, the panel should communicate:

- why an order is blocked
- why payout is delayed
- why a penalty exists
- why a product is under review
- what action is expected from seller

Do not force sellers to guess platform state from vague labels.

## Data Presentation Rules

Seller panel data should be clear and action-oriented.

### Good presentation principles

- clear status labels
- explicit deductions
- visible hold vs ready distinctions
- date and time visibility
- order/finance drill-down detail
- warnings for risky irreversible actions

### Avoid

- vague “processing” labels everywhere
- mixing hold, ready, and paid amounts
- hiding penalty impact
- showing unexplained finance reductions
- overloading seller with internal-only technical jargon

## Audit and History Rules

Important seller actions should remain traceable.

At minimum, history should exist for:

- order rejection
- shipment entry/update
- important payout-detail changes
- product moderation-relevant edits
- return/dispute response submissions
- major pricing/inventory changes where operationally relevant

Seller history should support both seller clarity and admin troubleshooting.

## Seller UX Rules

Seller panel should be practical, not decorative.

### Seller UX priorities

1. know what requires action
2. know what affects payout
3. know what is blocked and why
4. reduce accidental harmful actions
5. support routine operational speed

### Important UX expectations

- actionable order queues
- visible delay warnings
- visible payout timing/hold state
- explicit penalty/deduction visibility
- careful destructive action confirmations
- no misleading success states

## Things Claude Must Not Do

Do not:

- expose unpaid orders to sellers
- let sellers control payout state
- hide penalties or negative balances
- make order rejection casual or consequence-free
- expose admin-only risk notes
- allow sellers to rewrite lifecycle history
- mix pending, hold, ready, and paid amounts into one number
- allow sensitive account changes without security controls
- let seller store/profile edits break SEO rules silently

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/05-security-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `.claude/rules/10-admin-panel-rules.md`
- `docs/07-operations/order-lifecycle.md`
- `docs/07-operations/payout-lifecycle.md`
- `docs/05-security/seller-iban-verification.md`
- `docs/04-seo/seo-url-slug-rules.md`

If seller-facing order, payout, finance, or profile logic changes, update the related docs in the same work.
