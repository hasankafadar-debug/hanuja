import 'dotenv/config'
import { prisma } from '../../api/lib/prisma'
import { getMeilisearchConfig } from '../../api/lib/meilisearch'
import {
  processSearchIndexSync,
  rebuildProductSearchIndex,
} from '../../api/jobs/search-index-sync.job'
import { redis } from '../../api/lib/redis'
async function main() {
  if (await prisma.catalogInstallation.findUnique({ where: { id: 'category-search-v1' } })) {
    console.log('Category search projection already installed')
    return
  }
  const { baseUrl, apiKey } = getMeilisearchConfig()
  await rebuildProductSearchIndex(baseUrl, apiKey)
  for (let batch = 0; batch < 1000; batch++) {
    if (!(await prisma.searchIndexDirtyProduct.count())) break
    await processSearchIndexSync({ data: { type: 'dirty', operation: 'upsert' } } as Parameters<
      typeof processSearchIndexSync
    >[0])
  }
  if (await prisma.searchIndexDirtyProduct.count())
    throw new Error('Search projection is still pending; retry startup')
  await prisma.catalogInstallation.upsert({
    where: { id: 'category-search-v1' },
    create: { id: 'category-search-v1' },
    update: {},
  })
  console.log('Category search projection installed and dirty revisions drained')
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Search installation failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    if (redis.status !== 'wait') await redis.quit()
  })
