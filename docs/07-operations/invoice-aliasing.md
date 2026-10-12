# Invoice PDF Receiving (Resend)

Each paid order/seller pair has one permanent random invoice address under
`fatura.hanuja.com.tr`. In the seller-Hanuja model (2026-10) this address receives the
**seller's invoice to Hanuja** for the order. The seller sees it inside **Fatura Bilgileri**,
together with Hanuja's legal invoice identity (name, address, tax office/number, MERSİS) and the
waybill note. The customer's account email, identity number and billing address are never selected
for the seller view.

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
  cannot create a second invoice or audit record. The invoice and its audit record
  commit in one transaction; failed writes remove the newly stored file. The seller's
  invoice never notifies the customer.
- Unknown/ambiguous recipients and invalid attachments are terminal, acknowledged
  outcomes. Transient API/download/storage/DB failures return 503 for Resend retry.
  Download links are retrieved afresh from the provider API on each attempt.
- E-mail can fill only an empty order/designer invoice slot. Any existing PDF, including
  a pending or rejected invoice, is preserved; further e-mails record `blocked_invoice_policy`.
  Concurrent PDFs are serialized under the same pair lock. Corrections require an authorized
  panel upload with the current revision; provider signature verification does not establish
  the attachment sender's identity. The first PDF always requires manual admin review.
  Customers see only Hanuja's own invoice (`docs/07-operations/invoice-management.md`).
- Manual invoice upload remains available regardless of receiving status.

## Existing orders and release verification

Run `pnpm invoice-alias:backfill` in a configured production checkout/container
for a read-only count. After receiving is verified, run the same command with
`--apply` to complete missing aliases. `--order=<id>` restricts it to one order.
It never changes existing addresses and only processes paid seller-visible orders.
No schema migration is required. Deploy affected apps in the runbook order:
admin-panel, seller-panel, web.

Verify a dedicated test PDF sent to an order alias appears in the correct seller
invoice slot (seller panel and admin order detail, "Onay bekliyor"), can be viewed/downloaded
there, does not appear on another order/seller and does **not** appear for the customer.
Replay its webhook and verify a single invoice and audit record. Also verify manual PDF
upload and the three application health endpoints.

The legacy Postmark invoice/RET endpoints remain available for older integrations;
their Basic Auth credentials are optional and are not requirements for Resend.
