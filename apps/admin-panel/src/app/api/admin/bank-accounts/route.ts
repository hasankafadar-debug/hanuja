import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'

const createSchema = z.object({
  accountHolder: z.string().min(1).max(200),
  accountHolderNote: z.string().max(500).nullable().optional(),
  bankName: z.string().min(1).max(100),
  iban: z
    .string()
    .regex(/^TR\d{24}$/, 'IBAN TR ile başlamalı ve 26 karakter olmalıdır')
    .transform((v) => v.replace(/\s/g, '').toUpperCase()),
  branchName: z.string().max(100).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const svc = createPlatformBankAccountService({ prisma: createPrismaForRoute() })
  const accounts = await svc.listAll()
  return NextResponse.json({ data: accounts })
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const body = createSchema.parse(await req.json())
  const svc = createPlatformBankAccountService({ prisma: createPrismaForRoute() })
  const account = await svc.create({
    accountHolder: body.accountHolder,
    bankName: body.bankName,
    iban: body.iban,
    accountHolderNote: body.accountHolderNote ?? null,
    branchName: body.branchName ?? null,
    displayOrder: body.displayOrder,
  })
  return NextResponse.json({ data: account }, { status: 201 })
}
