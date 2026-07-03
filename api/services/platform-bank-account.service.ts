import type { PrismaClient } from '@prisma/client'

export type PlatformBankAccountData = {
  id: string
  accountHolder: string
  accountHolderNote: string | null
  bankName: string
  iban: string
  branchName: string | null
  displayOrder: number
  isActive: boolean
}

interface Deps {
  prisma: PrismaClient
}

export function createPlatformBankAccountService({ prisma }: Deps) {
  return {
    /** Aktif banka hesaplarını displayOrder'a göre sıralı döndürür. */
    async listActive(): Promise<PlatformBankAccountData[]> {
      return prisma.platformBankAccount.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          accountHolder: true,
          accountHolderNote: true,
          bankName: true,
          iban: true,
          branchName: true,
          displayOrder: true,
          isActive: true,
        },
      })
    },

    /** Tüm hesapları (aktif + pasif) döndürür (admin kullanımı). */
    async listAll(): Promise<PlatformBankAccountData[]> {
      return prisma.platformBankAccount.findMany({
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          accountHolder: true,
          accountHolderNote: true,
          bankName: true,
          iban: true,
          branchName: true,
          displayOrder: true,
          isActive: true,
        },
      })
    },

    async create(data: {
      accountHolder: string
      accountHolderNote: string | null | undefined
      bankName: string
      iban: string
      branchName: string | null | undefined
      displayOrder: number | undefined
    }): Promise<PlatformBankAccountData> {
      return prisma.platformBankAccount.create({
        data: {
          accountHolder: data.accountHolder,
          accountHolderNote: data.accountHolderNote ?? null,
          bankName: data.bankName,
          iban: data.iban,
          branchName: data.branchName ?? null,
          displayOrder: data.displayOrder ?? 0,
          isActive: true,
        },
        select: {
          id: true,
          accountHolder: true,
          accountHolderNote: true,
          bankName: true,
          iban: true,
          branchName: true,
          displayOrder: true,
          isActive: true,
        },
      })
    },

    async update(
      id: string,
      data: {
        accountHolder?: string
        accountHolderNote?: string | null
        bankName?: string
        iban?: string
        branchName?: string | null
        displayOrder?: number
        isActive?: boolean
      },
    ): Promise<PlatformBankAccountData> {
      return prisma.platformBankAccount.update({
        where: { id },
        data,
        select: {
          id: true,
          accountHolder: true,
          accountHolderNote: true,
          bankName: true,
          iban: true,
          branchName: true,
          displayOrder: true,
          isActive: true,
        },
      })
    },

    async delete(id: string): Promise<void> {
      await prisma.platformBankAccount.delete({ where: { id } })
    },
  }
}
