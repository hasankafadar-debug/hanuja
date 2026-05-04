import type { Prisma, PrismaClient } from '@prisma/client'

export function createCategoryRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.category.findUnique({
        where: { id },
        include: { children: true, parent: true },
      })
    },

    findBySlug(slug: string) {
      return prisma.category.findUnique({
        where: { slug },
        include: { children: true, parent: true },
      })
    },

    listRoots() {
      return prisma.category.findMany({
        where: { parentId: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
    },

    listByParent(parentId: string) {
      return prisma.category.findMany({
        where: { parentId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
    },

    findAll() {
      return prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
      })
    },

    update(id: string, data: Prisma.CategoryUpdateInput) {
      return prisma.category.update({
        where: { id },
        data,
      })
    },
  }
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>
