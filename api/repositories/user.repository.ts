import type { PrismaClient } from '@prisma/client'

export function createUserRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.user.findUnique({ where: { id } })
    },

    findByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } })
    },

    updateRole(id: string, role: 'customer' | 'seller' | 'admin') {
      return prisma.user.update({ where: { id }, data: { role } })
    },

    findWithSeller(id: string) {
      return prisma.user.findUnique({
        where: { id },
        include: { seller: true },
      })
    },
  }
}

export type UserRepository = ReturnType<typeof createUserRepository>
