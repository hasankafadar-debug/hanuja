export type User = {
  id: string
  email: string
  name: string | null
  role: 'customer' | 'seller' | 'admin'
  createdAt: Date
  updatedAt: Date
}
