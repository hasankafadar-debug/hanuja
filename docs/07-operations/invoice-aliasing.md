# Invoice PDF Receiving (Resend)

Each paid order/seller pair has one permanent random invoice address under
`fatura.hanuja.com.tr`. The seller sees this address inside **Fatura Bilgileri**,
directly below delivery information. The customer's account email is never
selected for the seller view. A separate billing address takes precedence;
delivery information is used when no separate billing address was selected.

## Production configuration

On **web, seller-panel and admin-panel**, configure:

- `INVOICE_ALIASING_ENABLED=true` after receiving infrastructure is verified.
- `INBOUND_EMAIL_DOMAIN=fatura.hanuja.com.tr` (identical on these three apps).

Only on **web**, configure runtime secrets:

- `RESEND_RECEIVING_API_KEY`: a dedicated Resend key capable of reading received
  attachments (Sending-only access is insufficient).
- `RESEND_INBOUND_WEBHOOK_SECRET`: signing secret for the dedicated inbound
  endpoint, separate from `RESEND_WEBHOOK_SECRET` for outgoing delivery tracking.

Secrets stay in Coolify; never put them in committed files or screenshots.
Run `pnpm check-env --env=prod --app=<app>` for each affected app.

## Resend and DNS

1. In the existing Resend account, add/verify `fatura.hanuja.com.tr` and enable
   receiving. Copy the exact receiving MX record provided by Resend into the
   authoritative DNS provider for `hanuja.com.tr` (Guzelhosting).
2. Add records only for this invoice subdomain. Preserve the root Promail MX/SPF
   records and the existing Resend sending records on `send.hanuja.com.tr`.
3. Configure an `email.received` webhook at
   `https://www.hanuja.com.tr/api/inbound/resend`. Put its signing secret in the
   web runtime. Existing `/api/webhooks/resend` delivery tracking is independent.
4. Verify the receiving MX in Resend, verify the API key can retrieve attachments,
   and deploy the signed inbound endpoint before enabling aliases.

References: [custom receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains),
[attachment retrieval](https://resend.com/docs/dashboard/receiving/attachments).

## Processing and recovery

- Payment confirmation waits for alias generation after the payment transaction
  commits. Alias failure does not undo a collected payment; detail-page access
  retries generation. Concurrent requests reuse the same unique alias.
- The inbound handler verifies the original body and Svix signature before DB/API
  access. Only active aliases belonging to paid, seller-visible orders match.
- Only PDF attachments are accepted automatically, with a PDF header and an
  actual byte limit of 20 MB. XML, images and link-only emails are recorded as
  `no_valid_attachment`; the seller uses manual upload for these cases.
- `resend:<email_id>` is the unique processing ID. Concurrent/redelivered events
  cannot create a second invoice or customer notification. Invoice and notification
  commit in one transaction; failed writes remove the newly stored file.
- Unknown/ambiguous recipients and invalid attachments are terminal, acknowledged
  outcomes. Transient API/download/storage/DB failures return 503 for Resend retry.
  Download links are retrieved afresh from the provider API on each attempt.
- The existing order/seller invoice slot is replaced on a new invoice; customer
  order details and Faturalarım use the existing authorized PDF view/download.
- Manual invoice upload remains available regardless of receiving status.

## Existing orders and release verification

Run `pnpm invoice-alias:backfill` in a configured production checkout/container
for a read-only count. After receiving is verified, run the same command with
`--apply` to complete missing aliases. `--order=<id>` restricts it to one order.
It never changes existing addresses and only processes paid seller-visible orders.
No schema migration is required. Deploy affected apps in the runbook order:
admin-panel, seller-panel, web.

Verify a dedicated test PDF sent to an order alias appears in the correct seller
invoice slot and in the customer's order detail, can be viewed/downloaded, and
does not appear on another order/seller. Replay its webhook and verify one invoice
notification. Also verify manual PDF upload and the three application health endpoints.

The legacy Postmark invoice/RET endpoints remain available for older integrations;
their Basic Auth credentials are optional and are not requirements for Resend.
