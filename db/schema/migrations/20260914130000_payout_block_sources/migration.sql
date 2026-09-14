-- Additive: old application versions can continue using blockedReason.
ALTER TABLE "payouts"
  ADD COLUMN "manualBlockedAt" TIMESTAMP(3),
  ADD COLUMN "manualBlockedBy" TEXT,
  ADD COLUMN "manualBlockedReason" TEXT,
  ADD COLUMN "automaticBlockReason" TEXT;

-- Unknown historical blocks are not safe to release automatically.
UPDATE "payouts"
SET "manualBlockedAt" = "updatedAt",
    "manualBlockedReason" = COALESCE("blockedReason", 'Önceki bloke: yönetici incelemesi gerekli')
WHERE status = 'payout_blocked';

-- Recognize only the existing scheduler's exact reasons and never override an
-- audited admin block. All other historical blocks retain manual protection.
UPDATE "payouts" p
SET "automaticBlockReason" = p."blockedReason", "manualBlockedAt" = NULL,
    "manualBlockedReason" = NULL
WHERE p.status = 'payout_blocked'
  AND (p."blockedReason" IN ('Doğrulanmış aktif banka hesabı bulunamadı',
       'Satıcı hesabı aktif değil', 'Açık iade talebi var', 'Açık uyuşmazlık var')
       OR p."blockedReason" IN ('Banka hesabı değişikliği incelemede: PENDING_ACTIVATION',
                                 'Banka hesabı değişikliği incelemede: BLOCKED'))
  AND NOT EXISTS (SELECT 1 FROM "admin_audit_logs" a
                  WHERE a."targetType" = 'payout' AND a."targetId" = p.id
                    AND a."actionType" = 'payout_blocked');
