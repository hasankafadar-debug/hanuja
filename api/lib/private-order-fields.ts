/** Defensive boundary for every non-admin order projection, including future includes. */
export function withoutAdminOrderNotes<T extends object>(order: T): Omit<T, 'adminNotes'> {
  const { adminNotes: _adminNotes, ...safe } = order as T & {
    adminNotes?: unknown
  }
  return safe
}
