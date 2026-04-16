/**
 * StatusBadge — domain-aware badge that maps Hanuja order/payout/return statuses
 * to visual Badge variants with Turkish labels.
 *
 * Covers: order lifecycle, payout states, return/dispute states, seller states.
 */
import * as React from "react"
import { Badge, type BadgeProps } from "../badge"

type BadgeVariant = BadgeProps["variant"]

interface StatusConfig {
  label: string
  variant: BadgeVariant
}

const STATUS_MAP: Record<string, StatusConfig> = {
  // ── Order payment states ──────────────────────────────────────
  draft:                        { label: "Taslak",              variant: "secondary" },
  checkout_started:             { label: "Ödeme Başlatıldı",    variant: "secondary" },
  payment_pending:              { label: "Ödeme Bekleniyor",    variant: "warning" },
  payment_confirmed:            { label: "Ödeme Onaylandı",     variant: "success" },
  payment_failed:               { label: "Ödeme Başarısız",     variant: "destructive" },
  payment_canceled:             { label: "Ödeme İptal",         variant: "destructive" },
  bank_transfer_waiting:        { label: "EFT/Havale Bekleniyor", variant: "warning" },
  bank_transfer_confirmed:      { label: "EFT/Havale Onaylandı", variant: "success" },

  // ── Seller fulfillment states ─────────────────────────────────
  seller_queue_ready:           { label: "Satıcıya İletildi",   variant: "info" },
  seller_reviewing:             { label: "Satıcı İnceliyor",    variant: "warning" },
  seller_accepted:              { label: "Satıcı Kabul Etti",   variant: "success" },
  seller_rejected:              { label: "Satıcı Reddetti",     variant: "destructive" },
  preparing:                    { label: "Hazırlanıyor",         variant: "info" },
  awaiting_shipment:            { label: "Kargoya Verilecek",   variant: "warning" },
  shipped:                      { label: "Kargoya Verildi",     variant: "info" },

  // ── Delivery states ───────────────────────────────────────────
  delivered:                    { label: "Teslim Edildi",       variant: "info" },
  delivery_confirmation_pending:{ label: "Teslim Onayı Bekleniyor", variant: "warning" },
  delivery_confirmed:           { label: "Teslim Onaylandı",    variant: "success" },

  // ── Cancellation states ───────────────────────────────────────
  canceled_by_customer:         { label: "Müşteri İptal",       variant: "destructive" },
  canceled_by_admin:            { label: "Yönetici İptal",      variant: "destructive" },
  canceled_due_to_payment_failure: { label: "Ödeme Hatası İptal", variant: "destructive" },
  canceled_due_to_seller_rejection: { label: "Satıcı Reddi İptal", variant: "destructive" },
  canceled_due_to_20_day_breach:{ label: "Süre Aşımı İptal",   variant: "destructive" },

  // ── Return / Dispute states ───────────────────────────────────
  return_requested:             { label: "İade Talep Edildi",   variant: "warning" },
  return_under_review:          { label: "İade İnceleniyor",    variant: "warning" },
  return_approved:              { label: "İade Onaylandı",      variant: "success" },
  return_rejected:              { label: "İade Reddedildi",     variant: "destructive" },
  return_in_transit:            { label: "İade Kargoda",        variant: "info" },
  return_received:              { label: "İade Alındı",         variant: "info" },
  refund_pending:               { label: "İade Ödemesi Bekleniyor", variant: "warning" },
  refund_completed:             { label: "İade Tamamlandı",     variant: "success" },
  dispute_open:                 { label: "Uyuşmazlık Açık",     variant: "destructive" },
  dispute_resolved:             { label: "Uyuşmazlık Çözüldü", variant: "success" },

  // ── Payout states ─────────────────────────────────────────────
  hold_active:                  { label: "Beklemede",           variant: "warning" },
  payout_blocked:               { label: "Ödeme Bloke",         variant: "destructive" },
  payout_ready:                 { label: "Ödemeye Hazır",       variant: "success" },
  payout_scheduled:             { label: "Ödeme Planlandı",     variant: "info" },
  payout_paid:                  { label: "Ödendi",              variant: "success" },
  penalty_applied:              { label: "Ceza Uygulandı",      variant: "destructive" },
  adjustment_applied:           { label: "Düzeltme Yapıldı",    variant: "secondary" },

  // ── Seller account states ─────────────────────────────────────
  active:                       { label: "Aktif",               variant: "success" },
  inactive:                     { label: "Pasif",               variant: "secondary" },
  suspended:                    { label: "Askıya Alındı",       variant: "destructive" },
  pending_review:               { label: "İnceleme Bekliyor",   variant: "warning" },
}

const FALLBACK: StatusConfig = { label: "Bilinmiyor", variant: "secondary" }

export interface StatusBadgeProps {
  status: string
  className?: string
  /** Override the display label */
  label?: string
}

function StatusBadge({ status, className, label }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? FALLBACK
  return (
    <Badge variant={config.variant} className={className}>
      {label ?? config.label}
    </Badge>
  )
}

/** Utility: get Turkish label for a given status string */
function getStatusLabel(status: string): string {
  return STATUS_MAP[status]?.label ?? status
}

export { StatusBadge, getStatusLabel }
