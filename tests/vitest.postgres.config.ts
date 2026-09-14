import { defineConfig } from 'vitest/config'

// No Prisma aliases: these tests exercise the real client and PostgreSQL locks.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['postgres/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 15_000,
  },
})
