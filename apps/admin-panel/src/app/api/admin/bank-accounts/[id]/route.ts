import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'

const updateSchema = z.object({
  accountHolder: z.string().min(1).max(200).optional(),
  accountHolderNote: z.string().max(500).nullable().optional(),
  bankName: z.string().min(1).max(100).optional(),
  iban: z
    .string()
    .regex(/^TR\d{24}$/, 'IBAN TR ile başlamalı ve 26 karakter olmalıdır')
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .optional(),
  branchName: z.string().max(100).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const { id } = await params
  const body = updateSchema.parse(await req.json())
  const svc = createPlatformBankAccountService({ prisma: createPrismaForRoute() })
  // exactOptionalPropertyTypes: undefined-içeren alanları null'a normalize et
  const account = await svc.update(id, {
    ...(body.accountHolder !== undefined && { accountHolder: body.accountHolder }),
    ...('accountHolderNote' in body && { accountHolderNote: body.accountHolderNote ?? null }),
    ...(body.bankName !== undefined && { bankName: body.bankName }),
    ...(body.iban !== undefined && { iban: body.iban }),
    ...('branchName' in body && { branchName: body.branchName ?? null }),
    ...(body.displayOrder !== undefined && { displayOrder: body.displayOrder }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
  })
  return NextResponse.json({ data: account })
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const { id } = await params
  const svc = createPlatformBankAccountService({ prisma: createPrismaForRoute() })
  await svc.delete(id)
  return NextResponse.json({ success: true })
}
