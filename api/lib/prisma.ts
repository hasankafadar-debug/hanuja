import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Use this in API route handlers when you need a Prisma reference.
 * Returns the singleton — same instance as `prisma`.
 */
export function createPrismaForRoute(): PrismaClient {
  return prisma
}

export default prisma
