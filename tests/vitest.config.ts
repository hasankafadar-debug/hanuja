import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { createRequire } from 'node:module'

const ROOT = resolve(__dirname, '..')
const webRequire = createRequire(resolve(ROOT, 'apps/web/package.json'))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'e2e/**', 'postgres/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    // Array form preserves order — more specific subpath aliases must come first
    alias: [
      // Use the installed application renderer for component security tests.
      { find: /^react$/, replacement: webRequire.resolve('react') },
      { find: /^react-dom\/server$/, replacement: webRequire.resolve('react-dom/server') },
      // Subpath BEFORE root — @prisma/client/runtime/library must not be
      // swallowed by the @prisma/client alias that comes after it.
      {
        find: '@prisma/client/runtime/library',
        replacement: resolve(__dirname, './__mocks__/prisma-runtime.ts'),
      },
      {
        find: '@prisma/client/runtime/client',
        replacement: resolve(__dirname, './__mocks__/prisma-runtime.ts'),
      },
      {
        find: '@prisma/client',
        replacement: resolve(__dirname, './__mocks__/prisma-client.ts'),
      },
      {
        find: '~/api',
        replacement: resolve(ROOT, 'api'),
      },
      {
        find: /^@hanuja\/api\/(.*)$/,
        replacement: `${resolve(ROOT, 'api')}/$1`,
      },
      {
        find: /^@\//,
        replacement: `${resolve(ROOT, 'apps/seller-panel/src')}/`,
      },
    ],
  },
})
