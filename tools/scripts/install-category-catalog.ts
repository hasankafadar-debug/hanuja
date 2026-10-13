import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { installCategoryCatalog } from '../../api/services/category-schema.service'
import catalog from '../../api/domain/category-catalog.json'

async function main() {
  const db = new PrismaClient()
  try {
    const existing = await db.category.findMany({
      select: { slug: true, name: true, parentId: true },
    })
    const slugs = new Set(existing.map((c) => c.slug))
    const missing = catalog.nodes.filter((c) => !slugs.has(c.slug))
    console.log(
      JSON.stringify({
        mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
        existing: existing.length,
        missing: missing.length,
        templates: catalog.templates.length,
      }),
    )
    if (process.argv.includes('--apply'))
      console.log(JSON.stringify(await installCategoryCatalog(db)))
  } finally {
    await db.$disconnect()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Category installation failed')
  process.exitCode = 1
})
