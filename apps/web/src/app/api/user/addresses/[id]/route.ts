import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { updateAddress, deleteAddress, setDefaultAddress } from '@hanuja/api/routes/user'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

interface Context {
  params: Promise<{ id: string }>
}

// PATCH /api/user/addresses/:id
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await ctx.params
    return updateAddress(req, session.user.id, id)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/user/addresses/:id
export async function DELETE(_req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await ctx.params
    return deleteAddress(session.user.id, id)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/user/addresses/:id/default handled separately, use PATCH with isDefault:true
// But we also support a dedicated default action via PUT
export async function PUT(_req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const { id } = await ctx.params
    return setDefaultAddress(session.user.id, id)
  } catch (err) {
    return handleError(err)
  }
}
