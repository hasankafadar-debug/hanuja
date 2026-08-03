import type { UserRole as PrismaUserRole } from '@prisma/client'
import { can, type UserRole as PermissionUserRole } from '@hanuja/security'

/**
 * Authenticated identity used to scope every dispute read and message write.
 *
 * PermissionUserRole intentionally includes the planned `support` role even
 * though the current Prisma UserRole enum does not yet persist that author
 * role. Support can therefore use its existing view-all permission without
 * being able to create a message with an inaccurate author label.
 */
export interface DisputeViewer {
  viewerId: string
  viewerRole: PermissionUserRole
}

export function canViewAllDisputes(role: PermissionUserRole): boolean {
  return can(role, 'dispute:view_all')
}

export function isPersistableDisputeAuthorRole(role: PermissionUserRole): role is PrismaUserRole {
  return role === 'customer' || role === 'seller' || role === 'admin'
}
