---
name: database-schema-flow
description: Apply Hanuja Prisma schema rules. Use when modeling database entities, enums, relations, indexes, event/history tables, seller ledger, or any schema migration work.
user-invocable: false
paths:
  - "db/**/*"
  - "packages/types/**/*"
model: sonnet
effort: high
---

This skill defines Hanuja database schema discipline.

Main principle:
PostgreSQL is the source of truth. Schema must reflect real business domain, not convenient UI shapes.

Core entity groups:
- Auth: User, Session, Account
- Seller: Seller, SellerProfile, SellerBankDetail, SellerLedgerEntry
- Catalog: Category, Product, ProductImage, ProductVariant
- Cart: Cart, CartItem
- Order: Order, OrderLine, OrderStatusHistory
- Payment: Payment, PaymentEvent
- Shipping: Shipment, ShipmentEvent
- Payout: Payout, PayoutBatch
- Penalty: Penalty
- Return/Dispute: ReturnRequest, Dispute, DisputeMessage
- Content: BlogPost, Page
- Common: Address, MediaAsset, AdminAuditLog, Notification

Critical schema rules:
1. Never merge payment status into order status — keep them separate columns/tables
2. delivered and delivery_confirmed must be distinguishable in schema
3. SellerLedgerEntry must be append-only (immutable event log)
4. Payout countdown reference must point to delivery_confirmed timestamp
5. OrderStatusHistory must be append-only with actor and timestamp
6. Penalty must have its own table with explicit reason, amount, status, waiver_actor
7. AdminAuditLog must record actor, target, action, before_state, after_state, reason

Enum naming rules:
- Use SCREAMING_SNAKE_CASE for enum values
- Keep enums granular enough to distinguish business stages
- Example OrderStatus values: DRAFT, PAYMENT_PENDING, PAYMENT_CONFIRMED, SELLER_QUEUE_READY, PREPARING, SHIPPED, DELIVERED, DELIVERY_CONFIRMED, CANCELLED_BY_CUSTOMER, CANCELLED_BY_SELLER, CANCELLED_BY_ADMIN

Index rules:
- Index foreign keys
- Index status columns queried frequently (order.status, payout.status)
- Index slug columns for SEO route resolution
- Index seller_id on all seller-scoped tables

Finance schema rules:
- Money values: use Decimal type, never Float
- Currency: store as ISO code string
- SellerLedgerEntry fields: type, amount, reference_type, reference_id, balance_after, created_at
- Payout fields: seller_id, amount, status, scheduled_at, paid_at, batch_id
- Penalty fields: order_id, seller_id, amount, reason, status, waived_by, waived_at, waived_reason

When implementing schema changes:
- identify the domain entity
- check if an existing table can be extended safely
- define all required fields with correct types
- add necessary indexes
- add history/event table if state transitions are important
- write migration with a clear description
- verify backward compatibility with existing records

Never accept:
- Float for money values
- status stored as arbitrary string without enum
- merged payment + order state in one field
- missing timestamps on important entities
- missing audit trail for finance mutations
- SellerLedgerEntry that can be edited/deleted
