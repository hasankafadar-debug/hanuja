import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { saveCatalogField, saveCatalogTemplate } from '@hanuja/api/services/catalog-admin.service'
const fieldSchema = z.object({
  preview: z.boolean().optional(),
  confirmationToken: z.string().optional(),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['select', 'number', 'boolean', 'text', 'size']),
  canonicalUnit: z.string().max(20).nullable(),
  isActive: z.boolean().optional(),
  config: z.object({
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          label: z.string().min(1).max(120),
          isActive: z.boolean(),
        }),
      )
      .optional(),
    subsets: z.record(z.array(z.string().min(1).max(80))).optional(),
    integer: z.boolean().optional(),
    measurement: z.string().optional(),
    inputUnits: z.string().optional(),
  }),
})
const templateSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9-]{0,49}$/),
  label: z.string().min(1).max(120),
  preview: z.boolean().optional(),
  confirmationToken: z.string().optional(),
  config: z.object({
    fields: z.array(
      z.object({
        key: z.string(),
        required: z.boolean(),
        displayUnit: z.string().optional(),
        optionIds: z.array(z.string()).optional(),
      }),
    ),
    requiredGroups: z.array(z.object({ label: z.string(), keys: z.array(z.string()) })),
    variantKey: z.string().nullable(),
    variantLabel: z.string().nullable(),
    contentKeys: z.array(z.string()),
    shared: z.object({ color: z.boolean(), material: z.boolean(), dimensions: z.boolean() }),
    materialLabels: z.array(z.string()),
  }),
})
async function actor() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
  return session.user.id
}
export async function GET() {
  try {
    await actor()
    const db = createPrismaForRoute()
    return ok({
      templates: await db.catalogTemplate.findMany({ orderBy: { code: 'asc' } }),
      fields: await db.catalogField.findMany({ orderBy: { label: 'asc' } }),
    })
  } catch (error) {
    return handleError(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    const csrf = checkCsrf(req)
    if (csrf) return csrf
    const id = await actor(),
      db = createPrismaForRoute()
    const body = await req.json()
    return ok(
      body.type === 'field'
        ? await saveCatalogField(db, id, fieldSchema.parse(body))
        : await saveCatalogTemplate(db, id, templateSchema.parse(body)),
    )
  } catch (error) {
    return handleError(error)
  }
}
