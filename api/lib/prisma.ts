import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

function findPrismaEngineLibrary() {
  const engineFileName =
    process.platform === 'win32'
      ? 'query_engine-windows.dll.node'
      : process.platform === 'darwin'
        ? 'libquery_engine-darwin.dylib.node'
        : 'libquery_engine-debian-openssl-3.0.x.so.node'

  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ]

  for (const baseDir of candidates) {
    const enginePath = path.join(baseDir, 'node_modules', '.prisma', 'client', engineFileName)
    if (fs.existsSync(enginePath)) {
      return enginePath
    }
  }

  return null
}

if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const enginePath = findPrismaEngineLibrary()
  if (enginePath) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Use this in API route handlers when you need a Prisma reference.
 * Returns the singleton — same instance as `prisma`.
 */
export function createPrismaForRoute(): PrismaClient {
  return prisma
}

export default prisma
