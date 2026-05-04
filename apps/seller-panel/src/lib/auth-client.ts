'use client'

import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SELLER_PANEL_URL ?? 'http://localhost:3001')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _client: any = createAuthClient({
  baseURL,
  plugins: [adminClient()],
})

export const signIn = _client.signIn
export const signOut = _client.signOut
export const signUp = _client.signUp
export const useSession = _client.useSession
export const getSession = _client.getSession
export const authClient = _client
