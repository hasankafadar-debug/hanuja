/** Server-side controls shared by privileged authentication flows. */
import type { PrismaClient } from '@prisma/client'

export async function revokeTrustedDevices(prisma: PrismaClient, userId: string): Promise<void> {
  // Better Auth trust records have a random `trust-device-` identifier and the
  // user id as their value. This also covers every browser, not just this one.
  await prisma.verification.deleteMany({
    where: { value: userId, identifier: { startsWith: 'trust-device-' } },
  })
}
