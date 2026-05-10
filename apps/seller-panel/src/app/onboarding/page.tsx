import { OnboardingPageClient } from './client-page'

export default function OnboardingPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return <OnboardingPageClient turnstileSiteKey={turnstileSiteKey} />
}
