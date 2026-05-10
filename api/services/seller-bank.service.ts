import type { PrismaClient } from '@prisma/client'
import { maskIban, HIGH_RISK_RATE_LIMIT, rateLimit } from '@hanuja/security'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createNotificationService } from './notification.service'
import { sendEmail } from '../lib/mailer'

function buildBankDetailEmail(params: {
  subject: string
  sellerName: string
  body: string
}) {
  return {
    subject: params.subject,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>${params.subject}</h2><p>Merhaba ${params.sellerName},</p><p>${params.body}</p></div>`,
    text: `Merhaba ${params.sellerName}, ${params.body}`,
  }
}

export function createSellerBankService({ prisma }: { prisma: PrismaClient }) {
  const auditLog = createAdminAuditLogRepository(prisma)
  const notifications = createNotificationService({ prisma })

  async function getSellerContext(sellerId: string) {
    return prisma.seller.findUnique({
      where: { id: sellerId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        bankDetails: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })
  }

  async function requestChange(params: {
    sellerId: string
    actorId: string
    iban: string
    accountHolder: string
    bankName: string
    ip?: string | null
    userAgent?: string | null
    reason?: string | null
  }) {
    const seller = await getSellerContext(params.sellerId)
    if (!seller || seller.userId !== params.actorId) {
      throw new Error('Banka bilgisi değiştirme yetkiniz yok.')
    }

    const limit = rateLimit(`seller-bank-change:${seller.id}`, HIGH_RISK_RATE_LIMIT)
    if (!limit.allowed) {
      throw new Error('Çok fazla deneme yaptınız. Lütfen daha sonra tekrar deneyin.')
    }

    const active = seller.bankDetails.find((detail) => detail.status === 'ACTIVE' || detail.isActive) ?? null
    const recentChangeCount = await prisma.sellerBankDetailHistory.count({
      where: {
        sellerId: seller.id,
        action: 'submitted',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    })

    const pendingPayouts = await prisma.payout.count({
      where: {
        sellerId: seller.id,
        status: { in: ['hold_active', 'payout_ready', 'payout_scheduled'] },
      },
    })

    const flags = {
      repeatedChanges: recentChangeCount >= 2,
      hasUpcomingPayout: pendingPayouts > 0,
      bankChanged: active?.bankName ? active.bankName !== params.bankName : false,
    }

    const created = await prisma.$transaction(async (tx) => {
      const detail = await tx.sellerBankDetail.create({
        data: {
          sellerId: seller.id,
          iban: params.iban,
          accountHolder: params.accountHolder,
          bankName: params.bankName,
          status: 'PENDING_ACTIVATION',
          isActive: false,
          isVerified: false,
          activatesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          stepUpVerifiedAt: new Date(),
          previousIbanMasked: active?.iban ? maskIban(active.iban) : null,
          changeReason: params.reason ?? null,
          flags,
        },
      })

      await tx.sellerBankDetailHistory.create({
        data: {
          sellerId: seller.id,
          bankDetailId: detail.id,
          action: 'submitted',
          ibanMasked: maskIban(params.iban),
          previousIbanMasked: active?.iban ? maskIban(active.iban) : null,
          actorId: params.actorId,
          actorRole: 'seller',
          ip: params.ip ?? null,
          userAgent: params.userAgent ?? null,
          reason: params.reason ?? null,
        },
      })

      return detail
    })

    await auditLog.createEntry({
      actorId: params.actorId,
      actionType: 'seller_bank_detail_changed',
      targetType: 'SellerBankDetail',
      targetId: created.id,
      previousData: { iban: active?.iban ? maskIban(active.iban) : null },
      newData: { iban: maskIban(params.iban), status: 'PENDING_ACTIVATION', flags },
      ...(params.reason ? { reason: params.reason } : {}),
    })

    await notifications.send({
      userId: seller.user.id,
      type: 'seller_bank_detail_pending',
      title: 'IBAN değişikliği alındı',
      body: 'IBAN değişikliği talebiniz alındı. 24 saat sonunda aktif olacaktır.',
      data: { bankDetailId: created.id },
    })

    const email = buildBankDetailEmail({
      subject: 'IBAN değişikliği talebiniz alındı',
      sellerName: seller.user.name ?? seller.displayName,
      body: `Yeni IBAN bilginiz ${maskIban(params.iban)} için güvenlik bekleme süresi başlatıldı. Bu işlem size ait değilse destek ekibimizle hemen iletişime geçin.`,
    })
    await sendEmail({ to: seller.user.email, subject: email.subject, html: email.html, text: email.text })

    return created
  }

  async function cancelPending(params: {
    sellerId: string
    bankDetailId: string
    actorId: string
    ip?: string | null
    userAgent?: string | null
  }) {
    const detail = await prisma.sellerBankDetail.findFirst({
      where: { id: params.bankDetailId, sellerId: params.sellerId, status: 'PENDING_ACTIVATION' },
      include: { seller: { include: { user: true } } },
    })
    if (!detail || detail.seller.userId !== params.actorId) {
      throw new Error('İptal edilecek bekleyen banka kaydı bulunamadı.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.sellerBankDetail.update({
        where: { id: detail.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
      await tx.sellerBankDetailHistory.create({
        data: {
          sellerId: detail.sellerId,
          bankDetailId: detail.id,
          action: 'cancelled',
          ibanMasked: maskIban(detail.iban),
          previousIbanMasked: detail.previousIbanMasked,
          actorId: params.actorId,
          actorRole: 'seller',
          ip: params.ip ?? null,
          userAgent: params.userAgent ?? null,
        },
      })
    })
  }

  async function approvePending(params: { bankDetailId: string; adminActorId: string; reason?: string | null }) {
    const detail = await prisma.sellerBankDetail.findUnique({
      where: { id: params.bankDetailId },
      include: { seller: { include: { user: true } } },
    })
    if (!detail || detail.status !== 'PENDING_ACTIVATION') {
      throw new Error('Onay bekleyen banka kaydı bulunamadı.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.sellerBankDetail.update({
        where: { id: detail.id },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
          verifiedBy: params.adminActorId,
        },
      })
      await tx.sellerBankDetailHistory.create({
        data: {
          sellerId: detail.sellerId,
          bankDetailId: detail.id,
          action: 'approved',
          ibanMasked: maskIban(detail.iban),
          previousIbanMasked: detail.previousIbanMasked,
          actorId: params.adminActorId,
          actorRole: 'admin',
          reason: params.reason ?? null,
        },
      })
    })

    await auditLog.createEntry({
      actorId: params.adminActorId,
      actionType: 'seller_bank_detail_approved',
      targetType: 'SellerBankDetail',
      targetId: detail.id,
      newData: { status: detail.status, verified: true },
      ...(params.reason ? { reason: params.reason } : {}),
    })

    await notifications.send({
      userId: detail.seller.user.id,
      type: 'seller_bank_detail_approved',
      title: 'IBAN değişikliği onaylandı',
      body: 'IBAN değişikliği talebiniz onaylandı. Aktivasyon zamanı geldiğinde yeni hesap kullanılacak.',
      data: { bankDetailId: detail.id },
    })

    const email = buildBankDetailEmail({
      subject: 'IBAN değişikliğiniz onaylandı',
      sellerName: detail.seller.user.name ?? detail.seller.displayName,
      body: `Yeni IBAN bilginiz ${maskIban(detail.iban)} için güvenlik onayı tamamlandı. Aktivasyon zamanı geldiğinde bu hesap kullanılacak.`,
    })
    await sendEmail({ to: detail.seller.user.email, subject: email.subject, html: email.html, text: email.text })
  }

  async function blockPending(params: { bankDetailId: string; adminActorId: string; reason: string }) {
    const detail = await prisma.sellerBankDetail.findUnique({
      where: { id: params.bankDetailId },
      include: { seller: { include: { user: true } } },
    })
    if (!detail) {
      throw new Error('Banka kaydı bulunamadı.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.sellerBankDetail.update({
        where: { id: detail.id },
        data: {
          status: 'BLOCKED',
          blockedAt: new Date(),
          blockedBy: params.adminActorId,
          blockedReason: params.reason,
          isVerified: false,
        },
      })
      await tx.sellerBankDetailHistory.create({
        data: {
          sellerId: detail.sellerId,
          bankDetailId: detail.id,
          action: 'blocked',
          ibanMasked: maskIban(detail.iban),
          previousIbanMasked: detail.previousIbanMasked,
          actorId: params.adminActorId,
          actorRole: 'admin',
          reason: params.reason,
        },
      })
    })

    await auditLog.createEntry({
      actorId: params.adminActorId,
      actionType: 'seller_bank_detail_blocked',
      targetType: 'SellerBankDetail',
      targetId: detail.id,
      newData: { status: 'BLOCKED' },
      reason: params.reason,
    })

    await notifications.send({
      userId: detail.seller.user.id,
      type: 'seller_bank_detail_blocked',
      title: 'IBAN değişikliği bloklandı',
      body: 'IBAN değişikliği talebiniz güvenlik kontrolü için bloklandı.',
      data: { bankDetailId: detail.id },
    })
  }

  async function activateEligiblePending() {
    const pending = await prisma.sellerBankDetail.findMany({
      where: {
        status: 'PENDING_ACTIVATION',
        activatesAt: { lte: new Date() },
        blockedAt: null,
      },
      include: {
        seller: { include: { user: true } },
      },
    })

    for (const detail of pending) {
      await prisma.$transaction(async (tx) => {
        await tx.sellerBankDetail.updateMany({
          where: { sellerId: detail.sellerId, isActive: true },
          data: {
            isActive: false,
            status: 'SUPERSEDED',
          },
        })

        await tx.sellerBankDetail.update({
          where: { id: detail.id },
          data: {
            isActive: true,
            status: 'ACTIVE',
            isVerified: true,
            verifiedAt: detail.verifiedAt ?? new Date(),
            activatedAt: new Date(),
          },
        })

        await tx.sellerBankDetailHistory.create({
          data: {
            sellerId: detail.sellerId,
            bankDetailId: detail.id,
            action: 'activated',
            ibanMasked: maskIban(detail.iban),
            previousIbanMasked: detail.previousIbanMasked,
            actorId: 'system:iban-activation-job',
            actorRole: 'system',
          },
        })
      })

      await notifications.send({
        userId: detail.seller.user.id,
        type: 'seller_bank_detail_activated',
        title: 'IBAN aktifleşti',
        body: `Yeni IBAN bilginiz ${maskIban(detail.iban)} artık aktif.`,
        data: { bankDetailId: detail.id },
      })
    }

    return pending.length
  }

  return {
    requestChange,
    cancelPending,
    approvePending,
    blockPending,
    activateEligiblePending,
  }
}
