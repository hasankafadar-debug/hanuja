import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateDocumentStorage } from '../../api/lib/private-document-storage'

const temporaryRoots: string[] = []

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hanuja-private-documents-'))
  temporaryRoots.push(root)
  return root
}

function pathForKey(root: string, key: string): string {
  const [, , shard, fileName] = key.split('/')
  if (!shard || !fileName) throw new Error(`Unexpected storage key: ${key}`)
  return join(root, shard, fileName)
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('PrivateDocumentStorage', () => {
  it('round-trips AES-256-GCM encrypted bytes without storing plaintext', async () => {
    const root = await createTemporaryRoot()
    const encryptionKey = Buffer.alloc(32, 0x42)
    const storage = createPrivateDocumentStorage({ root, encryptionKey })
    const plaintext = Buffer.from('%PDF-1.7\nhighly-sensitive-identity-document', 'utf8')

    const stored = await storage.write(plaintext)
    const encrypted = await readFile(pathForKey(root, stored.key))

    expect(stored.key).toMatch(/^private\/v1\/[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/)
    expect(stored.encryptedSizeBytes).toBe(encrypted.byteLength)
    expect(encrypted.subarray(0, 8).toString('ascii')).toBe('HNKYC001')
    expect(encrypted.includes(plaintext)).toBe(false)
    await expect(storage.read(stored.key)).resolves.toEqual(plaintext)
    await expect(storage.exists(stored.key)).resolves.toBe(true)
  })

  it('rejects ciphertext tampering through the GCM authentication tag', async () => {
    const root = await createTemporaryRoot()
    const storage = createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(32, 0x24) })
    const stored = await storage.write(Buffer.from('private KYC bytes'))
    const filePath = pathForKey(root, stored.key)
    const encrypted = await readFile(filePath)
    encrypted[encrypted.length - 1] ^= 0xff
    await writeFile(filePath, encrypted)

    await expect(storage.read(stored.key)).rejects.toThrow()
  })

  it('cannot decrypt a document with a different encryption key', async () => {
    const root = await createTemporaryRoot()
    const writer = createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(32, 0x11) })
    const reader = createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(32, 0x12) })
    const stored = await writer.write(Buffer.from('private KYC bytes'))

    await expect(reader.read(stored.key)).rejects.toThrow()
  })

  it('rejects traversal and non-canonical keys before touching the filesystem', async () => {
    const root = await createTemporaryRoot()
    const storage = createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(32) })

    await expect(storage.read('../../outside.bin')).rejects.toThrow(
      'Invalid private document storage key.',
    )
    await expect(storage.exists('private/v1/aa/../outside.bin')).rejects.toThrow(
      'Invalid private document storage key.',
    )
    await expect(storage.delete('/absolute/path.bin')).rejects.toThrow(
      'Invalid private document storage key.',
    )
  })

  it('fails closed when configuration is missing or invalid', async () => {
    const root = await createTemporaryRoot()

    expect(() =>
      createPrivateDocumentStorage({ root: 'relative/path', encryptionKey: Buffer.alloc(32) }),
    ).toThrow('PRIVATE_DOCUMENT_ROOT must be an absolute path.')
    expect(() => createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(31) })).toThrow(
      'Private document encryption key must be 32 bytes.',
    )
  })

  it('reports missing files and makes deletion idempotent', async () => {
    const root = await createTemporaryRoot()
    const storage = createPrivateDocumentStorage({ root, encryptionKey: Buffer.alloc(32) })
    const stored = await storage.write(Buffer.from('document'))

    await storage.delete(stored.key)
    await expect(storage.exists(stored.key)).resolves.toBe(false)
    await expect(storage.delete(stored.key)).resolves.toBeUndefined()
  })
})
