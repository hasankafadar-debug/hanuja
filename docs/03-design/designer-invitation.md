# Tasarımcı daveti

Public URL: `https://www.hanuja.com.tr/tasarimci-daveti`. This unlisted static brochure is shared directly or by QR. A public URL and `noindex` are not authentication or confidentiality controls.

## Supplied package and integrity

The supplied `hanuja-tasarimci-daveti` package's `index.html`, `assets/` and `qr/` were moved unchanged into `apps/web/public/tasarimci-daveti/`. Its `BENIOKU.md` remains at the repository root package directory, outside public serving. Do not rewrite the supplied HTML, CSS or JavaScript as React components.

`designer-invitation-sha256.json` records every original publication file's relative path, byte length and SHA-256 before the move. Validate the public files against this manifest after moving, building or publishing. The package has 66 publication files, including local fonts, GSAP/ScrollTrigger/Lenis, images, MP4/WebM video and QR artwork. Media provenance is described in `hanuja-tasarimci-daveti/BENIOKU.md`.

The previous React route (`apps/web/src/app/tasarimci-daveti/`) and its dedicated `public/designer-invitation/` media were removed after confirming there were no other application consumers.

## Routing, headers and discovery

- `apps/web/next.config.ts` uses a `beforeFiles` rewrite from `/tasarimci-daveti` to `/tasarimci-daveti/index.html`. No React layout, storefront navigation, footer or application JavaScript is injected into this HTML response.
- The invitation root and all files beneath `/tasarimci-daveti/` bypass storefront middleware. They require no authentication, CSRF cookie or language redirect.
- Both the root URL and all HTML, image, video, font, vendor and QR responses under it receive `X-Robots-Tag: noindex, nofollow`. The original HTML `noindex, nofollow` meta remains byte-for-byte intact. The retired `/designer-invitation/` path keeps its existing exclusion header.
- Do not add inbound links from storefront, account, seller/admin navigation, promotional modules, search or recommendations. Keep this URL absent from the sitemap and crawlable in `robots.txt` so crawlers can read the exclusion directive.
- Seller/admin host-wide indexing exclusions are unchanged; see `docs/04-seo/private-surface-indexing.md`.
- The storefront does not currently impose a Content-Security-Policy. This integration introduces no broader CSP relaxation. Inline styles/scripts, same-origin vendor/fonts and MP4/WebM must remain usable if a future policy is added.
- No immutable cache header is added: filenames are not fingerprinted. The HTML receives no custom long-lived cache policy.
- Application CTAs use the supplied `https://satici.hanuja.com.tr/basvuru`; the application workflow is unchanged.

## Supplied interaction and verification

The initial hero waits on its empty-stage image. The first downward wheel, touch scroll or supported scroll key starts the muted video while document scrolling stays locked. At the end, the supplied script unlocks scrolling and moves to the next section (desktop manifesto; mobile hero band). The package also contains its own 12-second fallback timer and reduced-motion handling. These behaviors belong to the supplied files and must not be silently altered during integration.

Run the repository build/typecheck gates and the existing middleware/indexing regression checks. In a real browser verify no console errors, missing assets or CSP violations; local vendor/font availability; initial idle hero; wheel and touch playback; stationary document until video end; automatic section transition; and no horizontal overflow at 390px. Verify MP4/WebM responses and QR/font/vendor assets, no CSRF cookies on the static response, original HTML hash equality, no sitemap/navigation discovery and unchanged public storefront indexing. Report any defect in the supplied behavior with evidence without editing the package.
