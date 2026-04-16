import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config — Hanuja critical user journeys.
 * Targets: storefront (:3000), seller-panel (:3001), admin-panel (:3002)
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false, // Ordered journeys — some depend on prior state
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'storefront',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
      },
      testMatch: '**/storefront/**/*.e2e.ts',
    },
    {
      name: 'seller-panel',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3001',
      },
      testMatch: '**/seller-panel/**/*.e2e.ts',
    },
    {
      name: 'admin-panel',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3002',
      },
      testMatch: '**/admin-panel/**/*.e2e.ts',
    },
  ],

  // webServer configs — uncomment when running against local dev
  // webServer: [
  //   { command: 'pnpm --filter web dev', url: 'http://localhost:3000', reuseExistingServer: true },
  //   { command: 'pnpm --filter seller-panel dev', url: 'http://localhost:3001', reuseExistingServer: true },
  //   { command: 'pnpm --filter admin-panel dev', url: 'http://localhost:3002', reuseExistingServer: true },
  // ],
})
