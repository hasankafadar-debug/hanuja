export type ProductStatus = 'draft' | 'published' | 'unlisted' | 'rejected'

export type Product = {
  id: string
  sellerId: string
  slug: string
  name: string
  status: ProductStatus
  price: number
  compareAtPrice: number | null
  createdAt: Date
  updatedAt: Date
}

export type Category = {
  id: string
  slug: string
  name: string
  parentId: string | null
}
