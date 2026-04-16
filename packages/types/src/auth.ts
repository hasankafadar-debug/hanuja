export type UserRole = 'customer' | 'seller' | 'admin'

export type AuthSession = {
  userId: string
  role: UserRole
  sellerId?: string
  email: string
}
