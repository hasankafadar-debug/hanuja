# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Seller Journeys

Source of truth: `.claude/rules/09-seller-panel-rules.md`, `CLAUDE.md` sections 2 and 15.

---

## Journey 1: Seller Onboarding

**Goal:** A new seller registers, submits their business application, enters bank details, and receives platform approval before any product or order actions become available.

### Steps

1. Seller visits registration page and creates an account with email and password.
2. Seller completes the seller application form:
   - Business name and legal identity
   - Tax and invoice information
   - Contact details
   - Store display name and planned product category
3. Application is submitted for admin review.
4. Seller enters IBAN and bank account details through the secure bank detail flow.
   - Bank detail entry is logged with actor, timestamp, and source.
   - New bank details do not activate for payout until verified by admin.
5. Admin reviews the application and bank detail submission.
6. Admin approves or requests correction with a documented reason.
7. On approval, seller account becomes active and the seller panel becomes operational.

### Rules

- Seller cannot list products or receive orders before approval.
- Bank detail changes at any later point follow the same verification and delay rules described in `docs/05-security/seller-iban-verification.md`.
- The onboarding state is visible in admin seller management screens.

---

## Journey 2: Product Creation

**Goal:** Seller creates a product draft, fills all required details, submits for platform review, and the product reaches published state on the storefront.

### Steps

1. Seller opens the product creation form in the seller panel.
2. Seller fills required fields:
   - Product title (specific, readable, not keyword-stuffed)
   - Short and full description
   - Material and production details
   - Dimensions and technical data
   - Price and stock quantity
   - Category assignment — selected level by level (`Ev`/`Ofis` → subcategory → …) and only a
     **leaf** category can be chosen; the form cannot be submitted while an intermediate level is
     still the deepest selection
   - Product images (uploaded to Cloudflare R2)
3. Seller saves as draft. Draft is not visible to customers or in search.
4. Seller submits the product for review.
5. Platform moderation reviews for content quality, prohibited claims, and category accuracy.
6. Moderator approves or requests revision with a documented reason.
7. On approval, product is published and becomes indexable on the storefront under `/urun/[slug]`.

### Rules

- Seller can only manage their own products. All queries are ownership-checked on the server.
- Moderation status (`draft`, `pending_review`, `published`, `unlisted`, `rejected`) is visible in the seller panel. These are the exact `ProductStatus` enum values from the schema.
- Platform-required fields must pass validation before submission is accepted.
- Published product slug is stable. Seller cannot rename the slug in ways that break the canonical URL or SEO routing.

---

## Journey 3: Order Fulfillment

**Goal:** Seller receives a paid order, accepts it, prepares the product, enters shipment tracking, and monitors delivery through to delivery_confirmed.

### Steps

1. Seller receives a notification that a new paid order is ready for review.
2. Seller opens the order in the seller panel.
   - Only payment-confirmed orders appear in the seller fulfillment queue.
   - Orders with payment_pending, bank_transfer_waiting, or payment_failed status are never shown.
3. Seller reviews order details: product lines, quantity, delivery address.
4. Seller accepts the order and begins preparation.
5. If seller cannot fulfill, seller initiates rejection:
   - A mandatory rejection reason must be selected (stock error, pricing error, production impossibility, force majeure, etc.).
   - A visible warning is shown: rejection of a paid order may trigger a 20% penalty on the product amount.
   - Seller confirms the rejection.
   - Admin is notified. Customer is notified. Cancellation and penalty evaluation begin immediately.
6. For accepted orders, seller marks order as preparing and later as awaiting_shipment.
7. Seller enters shipment tracking number and cargo provider when dispatching. Tracking entry is timestamped and linked to the order.
8. Order moves to shipped state. Seller can monitor delivery progress.
9. On cargo delivery signal or admin verification, order transitions to delivered.
10. After delivery is operationally confirmed (delivery_confirmed), payout hold countdown begins. Seller sees hold period start date and expected payout window.

### Rules

- Only payment-confirmed orders are visible to seller. This is enforced server-side.
- Rejection reason is mandatory and stored permanently. Seller cannot delete or hide rejection history.
- Once an order is shipped, the normal path forward is delivery and potential return — not simple cancellation.
- Seller cannot mark delivery_confirmed directly. This is determined by customer confirmation, cargo integration, admin review, or silent confirmation after 72 hours with no customer objection.
- Payout countdown starts from delivery_confirmed, never from shipped or delivered.

---

## Journey 4: Finance Visibility

**Goal:** Seller understands their earnings breakdown, deductions, hold period status, and when payout will be released.

### Steps

1. Seller opens the finance section of the seller panel.
2. Seller sees the earnings summary split into four explicit buckets:
   - Pending: orders not yet at delivery_confirmed
   - On hold: delivery_confirmed reached, within the mandatory 30-day hold period
   - Payout-ready: hold period completed, no blocking conditions remain
   - Paid: amounts already released by Hanuja
3. Seller drills into a specific order to see a full deduction breakdown:
   - Gross product amount
   - Commission deduction
   - Cargo charge deduction (if applicable)
   - Coupon cost share (if applicable)
   - Ad or service fee deductions
   - Penalty deductions
   - Net payout amount
4. Seller sees current negative balance with contributing reasons listed.
5. Seller sees estimated payout window for payout-ready amounts.
6. Seller sees penalty history: order reference, reason, amount, date, and current state (applied, waived, offset).

### Rules

- A single wallet total without line-item explanation is not sufficient.
- Every deduction must be labeled and linked to its source order or invoice.
- Negative balance must be visible and explained with the reason. It must not be hidden until payout time.
- Pending, on hold, payout-ready, and paid amounts must never be merged into one opaque figure.
- Seller has read-only visibility. Seller cannot modify any finance figure.

---

## Journey 5: Return Handling

**Goal:** Seller is notified of a return request, reviews the reason, submits a response where policy allows, and understands the effect on payout eligibility.

### Steps

1. Seller receives a notification that a return request has been opened on one of their orders.
2. Seller opens the return request in the seller panel.
3. Seller sees:
   - Customer reason for the return
   - Return request date
   - Whether the request is within the 14-day standard withdrawal window or after it
   - Current return status
   - Payout block indicator on the affected order
4. Seller submits a response or supporting evidence where platform policy allows.
5. Admin reviews the return. Seller cannot close the return unilaterally.
6. If return is approved by admin:
   - Seller payout for the affected order is reduced or blocked.
   - If payout was already released, a seller ledger debt is created and offset from future payouts.
7. If return is rejected by admin:
   - Seller is notified. Payout block on the order is lifted if no other condition blocks it.
8. Final resolution state is visible to seller in the return history. History is permanent.

### Rules

- Seller cannot issue a platform refund directly.
- Seller cannot suppress, edit, or delete return history.
- Any order with an open return has its payout blocked until the return is resolved.
- Returns within 14 days follow the standard fast-path withdrawal process.
- Returns after 14 days require admin evaluation and are not automatically approved.
- Seller response is recorded and visible to admin as part of the audit trail.

---

## Journey 6: Toplu Ürün Yükleme (Seller-Initiated)

**Goal:** Seller uploads multiple products at once using an XLSX file through the seller panel.

### Steps

1. Seller opens `/urunler/toplu-yukle` in the seller panel.
2. Seller selects the root area (Ev or Ofis), then narrows the scope level by level. Stopping at an
   intermediate level is allowed and intentional: the generated template then covers every leaf under
   that branch, so one file can carry products from several categories.
3. Seller downloads the XLSX template for the selected scope.
4. Seller fills the template with product data (name, category, price, stock, barcode, images, variants).
5. Seller uploads the completed XLSX file.
6. The form parses and validates the file client-side, showing a preview and any validation errors.
7. Seller submits the import. The API validates and persists each product group.
8. Results are shown: imported count and per-row errors if any.

### Rules

- Seller can only import products into their own account. Ownership is enforced server-side.
- Barcodes must be globally unique across all sellers. Conflicting barcodes are rejected row by row.
- Category must be within the selected scope. Out-of-scope category slugs are rejected.
- Only leaf categories are offered as the sheet's `Kategori*` values and accepted on import. A product
  can never be attached to an intermediate category — the rule is enforced in the domain layer
  (`api/domain/category-selection.ts`), so it applies to the form, the XLSX import and the Hipicon
  URL import alike. Template *scope* is a separate concern and may be an intermediate category.
- Images must be hosted on the platform CDN. External image URLs are rejected.
- Hipicon URL import is available from the seller panel at `/urunler/ice-aktar` and is scoped to the authenticated seller.
