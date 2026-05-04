# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Moderation Policy

## Overview

Product moderation is how Hanuja maintains catalog quality, customer trust, and legal safety.

Moderation applies to seller-submitted product content. It is a required operational step, not an
optional quality check. Products do not become publicly visible without passing through the
moderation state machine.

Source of truth for moderation behavior:
- `.claude/rules/10-admin-panel-rules.md` — admin moderation scope
- `.claude/rules/06-content-guidelines.md` — content quality rules
- `.claude/rules/04-seo-rules.md` — indexation and route implications
- `db/schema/schema.prisma` — `ProductStatus`, `Product`

---

## Product Moderation State Machine

The `ProductStatus` enum defines the following states:

| State | Meaning |
|---|---|
| `draft` | Seller is still editing — not submitted for review |
| `pending_review` | Seller submitted — awaiting admin review |
| `published` | Approved and live on storefront, eligible for search indexing |
| `unlisted` | Temporarily hidden — seller or admin took it offline |
| `rejected` | Admin rejected the submission — seller must revise and resubmit |

### Transition rules

- Seller moves a product from `draft` to `pending_review` by explicitly submitting it
- Admin moves from `pending_review` to `published` or `rejected`
- Admin or seller may move from `published` to `unlisted`
- Seller may move from `rejected` or `unlisted` back to `draft` to revise
- Seller cannot self-publish — the `published` state requires admin approval
- A `rejected` product retains its `rejectionReason` and `rejectedAt` fields for seller visibility

Only `published` products appear on the storefront and are eligible for Meilisearch indexing.
Non-published products must not appear in public search or category pages.

---

## What Moderation Reviews

When a product is in `pending_review`, admin evaluates:

### Required fields and completeness
- Product title is present, specific, and commercially useful
- Description is present and informative — not empty or placeholder
- At least one image is attached and relevant
- Price is set
- Category is assigned
- SKU or stock quantity is set where applicable

### Content quality
- Title is not keyword-stuffed or written in all-caps
- Description does not repeat the title mechanically
- Product attributes (material, dimensions, care notes) are internally consistent
- Image content matches the product being listed

### Prohibited content
The following result in automatic rejection without further review:

- content that violates Turkish law or platform policy
- health, medical, or safety claims without supporting certification
- counterfeit or unlicensed brand references
- adult or age-restricted content not approved for the platform
- hate language, discriminatory content, or offensive material
- fake reviews, fake stock urgency, or manufactured social proof
- pricing that is clearly below cost in a way that signals fraud

### Risky claims requiring closer evaluation
These do not result in automatic rejection but require admin to confirm the claim is supported:

- organic, natural, handcrafted, or artisan claims
- fire-resistant, waterproof, or child-safe claims
- specific material purity or grade claims (e.g., 100% cotton)
- warranty or guarantee language

### Duplicate and flood detection
- Near-identical products from the same seller submitted in bulk should be reviewed for duplication
- Products that share title, images, and description with minimal variation may be flagged
- Admin may request seller differentiation before approving a batch of near-duplicate listings

---

## Moderation Decision Actions

### Approve

Admin selects `published`. The product becomes live. Meilisearch sync is triggered on the next
indexing job run. No `rejectionReason` is recorded.

### Reject

Admin selects `rejected` and must provide a `rejectionReason`. The rejection reason is stored on
the `Product` record and is visible to the seller in the seller panel. The seller is notified via
the `seller_penalty_applied` or a moderation-specific notification (implementation may use a
dedicated notification type).

The rejection reason must be:
- specific enough for the seller to understand what needs to change
- not a generic placeholder like "not acceptable"
- referencing the exact issue (e.g., missing material description, prohibited health claim, title stuffing)

### Request revision

If the product is close to acceptable but needs a specific correction, admin may leave it in
`pending_review` and send a message through seller communication channels explaining what is needed.
This avoids a full rejection cycle for minor issues.

### Hide a published product

Admin may move a `published` product to `unlisted` when:
- a post-publication complaint surfaces
- a legal or compliance concern is raised after publication
- the product becomes out of scope for the platform
- the seller is suspended

Unlisting a product removes it from the storefront and search index immediately. The product is not
deleted — it remains visible to the seller and admin with `unlisted` status.

---

## Seller Suspension Triggers

Seller suspension is a separate action from product moderation, but moderation outcomes feed
suspension risk signals.

### Immediate suspension triggers

The following may result in immediate seller suspension (status: `suspended`) pending admin review:

- verified fraud in product listing or order behavior
- deliberate deceptive content after a prior rejection for the same issue
- listing counterfeit or legally prohibited goods
- multiple confirmed policy violations within a short period
- fraud signals from the payment or payout system

### Accumulated risk triggers

Gradual signals that elevate seller risk and may lead to suspension review:

- repeated seller order rejections at a rate above platform threshold
- repeated product rejections for the same type of violation
- multiple open disputes with a pattern suggesting systematic deception
- IBAN or payout detail changes flagged as anomalous
- repeated return or dispute abuse patterns (from the customer side or the seller side)

### Suspension process

1. Admin identifies suspension trigger via the seller risk panel or a moderation outcome
2. Admin moves seller status from `active` to `suspended` using the `seller_suspended` admin action
3. The action is recorded in `AdminAuditLog` with `actionType: seller_suspended`, reason, actor, and timestamp
4. Seller is notified via the `seller_suspended` notification type
5. All seller products are moved to `unlisted` on suspension
6. Active orders continue — seller is still expected to fulfill orders that were already in progress unless admin cancels them explicitly
7. No new orders enter the seller's queue after suspension

---

## Reinstatement Process

A suspended seller may be reinstated to `active` status after:

1. Admin review of the suspension reason and seller response
2. Seller acknowledges the policy violation and provides corrective steps if required
3. Admin confirms that outstanding issues are resolved (e.g., disputed products removed, deceptive content corrected)
4. Admin sets seller status to `active` using the `seller_activated` admin action
5. The action is recorded in `AdminAuditLog` with `actionType: seller_activated`, reason, and actor
6. Seller is notified of reinstatement
7. Previously unlisted products do not automatically republish — seller must resubmit for review

Reinstatement is not automatic. It requires an explicit admin decision. Sellers with a pattern of
repeated suspension or fraud are not eligible for reinstatement without escalation to super admin.

---

## SEO Impact of Moderation State Changes

Moderation state changes have SEO consequences that must be respected.

| Moderation change | SEO effect |
|---|---|
| `pending_review` → `published` | Product becomes indexable; added to next sitemap generation |
| `published` → `unlisted` | Product must be removed from Meilisearch index; sitemap entry removed |
| `published` → `rejected` (rare) | Same as unlisted — remove from index |
| `rejected` → `published` (resubmit) | Treat as new publication; no permanent URL is lost if slug was unchanged |

If a published product's slug changes during revision, the old slug must produce a 301 redirect to
the new slug. Slug changes after initial publication should be avoided except in cases of clear
error.

Meilisearch must not index `draft`, `pending_review`, `unlisted`, or `rejected` products. Only
`published` products belong in the search index.

---

## Admin Moderation Queue

The admin moderation queue is a filtered view of products in `pending_review`, ordered by
submission time ascending (oldest first).

The queue must show for each pending product:
- product title
- seller name and seller risk level
- category
- submission time
- image preview
- quick-action buttons for approve, reject, or request revision

Admin should be able to sort the queue by seller risk level to prioritize high-risk submissions.

Rejected products that are resubmitted appear in the queue again and must be reviewed fresh —
previous rejection reasons are shown alongside the new submission to help admin compare what changed.

---

## Moderation Audit Requirements

Every moderation decision is recorded:

- product approval: `AdminAuditLog` with the product ID and new status `published`
- product rejection: `AdminAuditLog` with product ID, `rejectionReason`, and actor
- seller suspension: `AdminAuditLog` with `actionType: seller_suspended`, reason mandatory
- seller reinstatement: `AdminAuditLog` with `actionType: seller_activated`, reason mandatory

The `Product.rejectionReason` and `Product.rejectedAt` fields are set on rejection and must be
visible to the seller. They must not be overwritten without a new audit entry.

---

## Cross-Reference

- `.claude/rules/10-admin-panel-rules.md` — product and content moderation rules
- `.claude/rules/06-content-guidelines.md` — content quality, prohibited claims, tone
- `.claude/rules/04-seo-rules.md` — indexation rules for non-published products
- `.claude/rules/09-seller-panel-rules.md` — seller visibility of moderation state
- `docs/07-operations/order-lifecycle.md` — seller suspension effect on active orders
- `docs/05-security/audit-logging-plan.md` — audit log requirements
