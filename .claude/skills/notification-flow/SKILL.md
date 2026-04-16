---
name: notification-flow
description: Apply Hanuja notification rules. Use when implementing event-driven notifications, email templates, in-app notifications, BullMQ notification jobs, or Turkish-language notification content.
user-invocable: false
paths:
  - "api/jobs/notification*"
  - "api/services/notification*"
  - "api/repositories/notification*"
  - "apps/web/src/**/notification*"
  - "apps/seller-panel/src/**/notification*"
model: sonnet
effort: medium
---

This skill defines Hanuja notification discipline.

Main principle:
Notifications are event-driven side effects, not the primary business action. They must never be synchronous blockers. Use BullMQ for all notification dispatch.

Notification types:
- Email (transactional)
- In-app (stored in Notification table, polled or SSE)
- SMS (optional, future)

Key notification events (Turkish subjects):
Customer notifications:
- order.payment_confirmed → "Siparişiniz alındı (#ORDER_NO)"
- order.seller_accepted → "Siparişiniz hazırlanıyor"
- order.shipped → "Siparişiniz kargoya verildi"
- order.delivered → "Siparişiniz teslim edildi"
- order.delivery_confirmed → "Siparişiniz teslim onaylandı"
- order.cancelled → "Siparişiniz iptal edildi"
- return.approved → "İade talebiniz onaylandı"
- return.rejected → "İade talebiniz reddedildi"
- refund.completed → "İadeniz hesabınıza aktarıldı"

Seller notifications:
- order.payment_confirmed → "Yeni sipariş (#ORDER_NO)"
- order.seller_action_required → "Siparişinizi onaylamanız gerekiyor"
- shipment.overdue_warning → "Kargo süresi dolmak üzere"
- payout.ready → "Ödeme hazır (#AMOUNT ₺)"
- penalty.applied → "Ceza uygulandı: #AMOUNT ₺"
- return.opened → "İade talebi açıldı"

Admin notifications:
- payment.eft_pending → "Havale onayı bekliyor"
- seller.new_registration → "Yeni satıcı başvurusu"
- dispute.opened → "Uyuşmazlık açıldı"
- risk.flag → "Risk işareti: #REASON"

Notification record schema:
- user_id
- type (ORDER_CONFIRMED, SHIPMENT_CREATED, etc.)
- title
- body
- link (deep link to relevant page)
- read_at (null = unread)
- created_at

BullMQ notification queue rules:
1. All notification dispatch via notification queue — never synchronous
2. Email: use transactional email provider (Resend, Postmark, etc.)
3. Retry on failure with backoff
4. Log delivery status
5. Do not retry indefinitely — after N failures, mark as failed and alert

Email template rules:
- Turkish-first content
- Brand-consistent template using design tokens
- Plain text fallback for every HTML email
- Unsubscribe link for marketing-style emails
- No unsubscribe needed for transactional (order, payout, penalty)

In-app notification rules:
- Store in Notification table
- Mark as read via API (PATCH /api/notifications/:id/read)
- Notification bell shows unread count
- Max show last 50 notifications in panel

When implementing notification logic:
- emit notification event as a side effect of business action
- use queue, never await inside business transaction
- keep notification content close to business event source
- write Turkish content naturally, not machine-translated
- test that notification fails silently (doesn't break main flow)

Never accept:
- synchronous email send inside payment confirmation transaction
- notification failure that breaks order creation
- hardcoded email templates without design token support
- notifications without read/unread state
- sending notifications for unverified events
