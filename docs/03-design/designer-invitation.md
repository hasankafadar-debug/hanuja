# Tasarımcı daveti

Public route: `/tasarimci-daveti`. This is a deliberately unlisted recruitment page, intended to be shared directly or through the invitation QR. It is publicly accessible; the URL is not an authentication or confidentiality boundary.

## Routing and discovery

- The route lives directly under `apps/web/src/app`, outside `(storefront)`, so it does not inherit the storefront header, category navigation or footer.
- Do not add inbound links from storefront, account, seller or admin navigation, promotional modules, search results or recommendations.
- The explicit static allowlist in `apps/web/src/app/sitemap.ts` excludes this route. Dynamic sitemap entries only describe catalog/blog/designer paths.
- The page overrides root metadata with `noindex, nofollow`, including the Googlebot override. Keep it crawlable in `robots.txt` so crawlers can read that metadata. A noindex instruction does not make a public URL private.
- The invitation URL and its dedicated media folder also receive `X-Robots-Tag: noindex, nofollow`. Other web routes retain their existing indexing behavior. See `docs/04-seo/private-surface-indexing.md` for the panel-wide exclusion policy.
- All application CTAs use `${getSellerPanelUrl()}/basvuru`, the same application destination already used by the storefront. The form and its authentication/document workflow are unchanged.

## Content and operating model

The invitation introduces product-led advertising through Meta/Google Ads, Pinterest and creator collaborations as a planned visibility strategy. It promises no fixed advertising allocation per product, sales results, commission percentage or unverified comparative savings. It describes a low-commission approach; actual commercial terms are shared before contracting.

The onboarding offer includes free product-upload support by the software/integration team, using the designer's website or supplied product images/information. The concise FAQ follows the current operating model: Hanuja sells to and invoices customers and manages customer support/returns; designers prepare and ship products, invoice Hanuja and coordinate product returns/inspection. References: `docs/07-operations/hanuja-seller-model.md`, `docs/01-business/commission-policy.md`, and the live `/basvuru` route in `apps/seller-panel`.

## Visual assets

Assets are self-hosted under `apps/web/public/designer-invitation/`. Existing compressed WebP files are rendered through Next Image with `unoptimized`; this avoids expanding the restricted application image-proxy allowlist and avoids recompressing these small local assets.

| Asset                                    | Source and role                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hero.webp`                              | Built-in `image_gen`, 2026-10-19. Illustrative editorial gallery: ivory plaster, travertine, walnut lounge chair, oatmeal upholstery, olive vessel and warm afternoon light. Clean left space for type; no generated text, logos or UI. 1672×941, WebP quality 85. |
| `detail.webp`                            | Built-in `image_gen`, 2026-10-19. Illustrative ceramic workbench: artist hands smoothing a folded-rim ivory vessel, warm natural sidelight and tactile neutral materials. No generated text, logos or UI. 1122×1402, WebP quality 85.                              |
| `panel-orders.webp`                      | Actual Hanuja seller-panel order view, captured locally using demonstration data. 1440×1000.                                                                                                                                                                       |
| `panel-products.webp`                    | Actual Hanuja seller-panel product/stock view, captured locally using demonstration data. 1440×1000.                                                                                                                                                               |
| `panel-shipping.webp`                    | Actual Hanuja seller-panel shipment view, captured locally using demonstration data. 1440×1000.                                                                                                                                                                    |
| `panel-tour.webm`                        | Silent recording of actual seller-panel interaction using demonstration data; native playback controls, no autoplay.                                                                                                                                               |
| `invitation-qr.svg`, `invitation-qr.png` | Share assets pointing directly to the production invitation URL. Not navigation links.                                                                                                                                                                             |

Hero/detail images are concept photography, not evidence of offered SKUs, actual designer partnerships or catalog availability. Do not add product/designer names, fabricated endorsements or performance figures to these images. Panel screenshots and the tour must remain actual application captures; do not replace them with drawn dashboards.

Panel captures use the current seller-panel Next.js application with a dedicated synthetic localhost fixture: 6 sample products, 12 sample orders and 8 sample shipments. They contain no real customer/account information and no substituted route markup. Concept-image thumbnails illustrate the synthetic products. The source evidence is retained locally at `output/playwright/designer-invitation/capture-evidence.json` and is not published with the page.

The hero alone loads eagerly. Story imagery and panel screenshots use lazy image loading. The video uses `preload="none"`, a real panel poster and explicit native controls. No external video player or new motion library is required.

## Interaction and accessibility

- Short staggered hero entrance; natural document scrolling with no scroll hijack.
- A desktop sticky image accompanies three editorial visibility chapters, with a scroll-linked depth shift and progress caption. The mobile version uses compact stacked chapters without empty scroll tracks.
- Below-fold reveal transitions, button-arrow hover affordances and native FAQ disclosures.
- `prefers-reduced-motion` removes entrances, depth shifts and transitions. The server-rendered content starts visible; only below-viewport elements are marked for reveal after the observer is created. Content and native FAQ remain usable without JavaScript.
- The existing web loading UI is shared by the `(storefront)` and `(auth)` route groups. It is no longer a root loading boundary around the standalone invitation: that boundary stored even the static invitation in a hidden streamed segment requiring JavaScript to reveal it. The store/auth loader markup is preserved in `apps/web/src/components/page-loading.tsx`; existing nested order loading remains unchanged.
- Keyboard-visible focus, a skip link, descriptive image alternatives, native video controls and an accessible panel tablist with arrow/Home/End navigation.
- Screenshot tabs link to the full-resolution image in a new tab for closer inspection and mobile pinch zoom. The video has native fullscreen controls.
- No continuous ambient animation or autoplay. The silent panel video has an adjacent textual description and individual screen views.

## Verification

Run web typecheck/lint plus the repository release checks. Verify direct unauthenticated access, noindex/nofollow metadata, absence from the sitemap and all navigation, application destinations, all six visual media assets, actual video playback, keyboard tabs and reduced-motion/no-JavaScript behavior. Review the hero at desktop 1440×900 and short wide desktop sizes, and at 390×844/320px mobile widths. Confirm no horizontal overflow and no overlapping hero copy.
