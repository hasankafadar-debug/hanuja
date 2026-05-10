import { SignupPageClient } from './client-page'

export default function KayitPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return <SignupPageClient turnstileSiteKey={turnstileSiteKey} />
}
