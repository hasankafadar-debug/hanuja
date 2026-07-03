import { Prisma } from '@prisma/client'

export function isMissingDatabaseObjectError(
  error: unknown,
  options?: { tableNames?: string[] },
): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (!['P2021', 'P2022'].includes(error.code)) return false

  if (!options?.tableNames?.length) return true

  const metaText = JSON.stringify(error.meta ?? {})
  return options.tableNames.some((tableName) => metaText.includes(tableName))
}
