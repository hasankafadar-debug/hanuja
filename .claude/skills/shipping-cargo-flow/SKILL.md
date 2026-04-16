---
name: shipping-cargo-flow
description: Apply Hanuja shipping and cargo integration rules. Use when implementing shipment creation, tracking number entry, cargo provider integration, delivery status mapping, or shipment timeline logic.
user-invocable: false
paths:
  - "api/services/shipment*"
  - "api/routes/shipment*"
  - "api/repositories/shipment*"
  - "apps/seller-panel/src/**/shipment*"
  - "apps/seller-panel/src/**/cargo*"
model: sonnet
effort: medium
---

This skill defines Hanuja shipping and cargo discipline.

Main principle:
Shipment is a separate domain from order. Delivery status from cargo does not automatically equal delivery_confirmed — that is a separate platform event.

Shipment lifecycle states:
- PREPARING: seller preparing for shipment
- HANDED_TO_CARGO: package handed to cargo provider
- IN_TRANSIT: cargo tracking active
- OUT_FOR_DELIVERY: out for delivery (if provider supports)
- DELIVERED: cargo says delivered to address
- DELIVERY_FAILED: delivery attempt failed
- RETURNED_TO_SENDER: returned after failed delivery

Cargo provider integration rules:
1. Cargo providers are abstracted behind a ShipmentAdapter interface
2. Each provider maps to the internal ShipmentStatus enum
3. Tracking events stored as ShipmentEvent (append-only log)
4. Webhook/polling from cargo provider updates ShipmentEvent
5. When cargo says DELIVERED → trigger delivery confirmation evaluation logic

Delivery confirmation flow (critical):
- cargo DELIVERED → system creates delivery_confirmation_pending signal
- Customer may confirm via "Teslim Aldım" button (customer_confirmed)
- OR: silent confirmation fires after 72 hours if no objection (timer_confirmed)
- OR: admin manually confirms (admin_confirmed)
- delivery_confirmed event → starts payout hold countdown
- NEVER start payout from cargo DELIVERED alone

Seller panel shipment actions:
- Enter tracking number (required after PREPARING)
- Select cargo provider
- View shipment timeline
- See delivery status
- Cannot mark delivery_confirmed directly

Shipment record must capture:
- order_id
- seller_id
- cargo_provider (MNG, PTT, YURTICI, ARAS, UPS, etc.)
- tracking_number
- tracking_url (optional)
- status
- handed_at (timestamp)
- estimated_delivery (optional)
- ShipmentEvent history (append-only)

Turkish cargo providers to support:
- MNG Kargo
- PTT Kargo
- Yurtiçi Kargo
- Aras Kargo
- UPS Türkiye
- Sürat Kargo

Tracking rules:
- Tracking number must be validated for format where possible
- Tracking URL should be constructable per provider
- External tracking page link can be surfaced to customer
- Internal polling or webhook updates tracking status

When implementing shipping logic:
- identify the cargo provider integration point
- abstract provider-specific logic behind adapter
- map provider status to internal ShipmentStatus
- trigger delivery confirmation evaluation when DELIVERED is reached
- log all tracking events with timestamp

Never accept:
- treating cargo DELIVERED as delivery_confirmed
- missing ShipmentEvent history
- starting payout countdown from shipment creation
- hardcoded provider-specific logic spread across codebase
- tracking number accepted without cargo provider reference
