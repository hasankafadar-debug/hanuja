import { expect, type Page } from '@playwright/test'

const HYDRATION_PATTERNS = [
  /Recoverable Error/i,
  /Hydration failed because the server rendered text didn't match the client/i,
  /server rendered text didn't match the client/i,
  /There was an error while hydrating/i,
]

function isHydrationMessage(message: string) {
  return HYDRATION_PATTERNS.some((pattern) => pattern.test(message))
}

export function trackHydrationErrors(page: Page) {
  const messages = new Set<string>()

  const record = (message: string) => {
    if (isHydrationMessage(message)) {
      messages.add(message)
    }
  }

  page.on('console', (entry) => {
    if (entry.type() === 'error' || entry.type() === 'warn') {
      record(entry.text())
    }
  })

  page.on('pageerror', (error) => {
    record(error.message)
  })

  return {
    async expectNone() {
      expect([...messages]).toEqual([])
    },
  }
}
