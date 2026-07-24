/**
 * Idempotent reference-data script — renk/materyal seçeneklerini (ProductAttributeOption)
 * `db/seeds/attribute-options.ts` içindeki küratörlü listeden upsert eder.
 *
 * Neden ayrı script: yeni renkler (ör. Eskitme, Mix, Pirinç, Rose Altın) otomatik
 * migration ile gitmez. Tam `pnpm db:seed` prod'da test verisi üretir; bu yüzden
 * yalnız seedAttributeOptions çağrılır. Upsert `type_slug` üzerinden idempotenttir —
 * güvenle tekrar çalıştırılabilir; mevcut ürün-renk bağlarını (ProductAttributeValue)
 * etkilemez, yalnız seçenek listesi + sortOrder (palet sırası) güncellenir.
 *
 * Kullanım (prod DATABASE_URL'e karşı, tek seferlik):
 *   pnpm attributes:seed
 *
 * Bkz: .claude/rules/12-production-readiness.md
 */
import prisma from '../../api/lib/prisma'
import { seedAttributeOptions } from '../../db/seeds/attribute-options'

async function main() {
  await seedAttributeOptions(prisma)
  console.log('[seed-attribute-options] Renk/materyal seçenekleri upsert edildi.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[seed-attribute-options] failed', error)
    await prisma.$disconnect()
    process.exit(1)
  })
