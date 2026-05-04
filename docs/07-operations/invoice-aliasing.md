# Invoice Aliasing Operations

## Domain Split

- Web/customer/storefront: `https://hanuja.com.tr`
- Seller panel: `https://satici.hanuja.com.tr`
- Admin panel: `https://admin.hanuja.com.tr`
- Invoice inbound mail: `fatura.hanuja.tr`

## Required Production Env

- `INVOICE_ALIASING_ENABLED=true`
- `INBOUND_EMAIL_DOMAIN=fatura.hanuja.tr`
- `POSTMARK_INBOUND_WEBHOOK_USER`
- `POSTMARK_INBOUND_WEBHOOK_PASS`

## Postmark Setup

- Point MX for `fatura.hanuja.tr` to Postmark inbound.
- Configure Postmark inbound webhook to `https://hanuja.com.tr/api/inbound/postmark`.
- Enable HTTP Basic Auth on the webhook URL using the production env values above.
- Keep manual seller invoice upload enabled as fallback.
