import type { NextRequest } from 'next/server'
import { consumeStepUpGrant, type CriticalCapability } from '@hanuja/api/lib/auth-security'
import { StepUpRequiredError } from '@hanuja/api/lib/errors'

type SessionIdentity = { user: { id: string }; session?: { id?: string } }

/** Consumes one grant before a critical route invokes any business logic. */
export async function requireAdminStepUp(
  request: NextRequest,
  session: unknown,
  capability: CriticalCapability,
): Promise<void> {
  const identity = session as SessionIdentity
  const sessionId = identity.session?.id
  if (!sessionId) throw new StepUpRequiredError()
  await consumeStepUpGrant(request.headers.get('x-step-up-token'), {
    userId: identity.user.id,
    sessionId,
    capability,
  })
}
