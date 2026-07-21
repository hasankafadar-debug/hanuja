import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { access, chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

const MAGIC = Buffer.from('HNKYC001', 'ascii')
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH
const STORAGE_KEY_PATTERN = /^private\/v1\/([0-9a-f]{2})\/([0-9a-f-]{36}\.bin)$/

export function isPrivateDocumentStorageKey(fileKey: string): boolean {
  return STORAGE_KEY_PATTERN.test(fileKey)
}

export interface PrivateDocumentStorage {
  write(plaintext: Uint8Array): Promise<{ key: string; encryptedSizeBytes: number }>
  read(fileKey: string): Promise<Buffer>
  exists(fileKey: string): Promise<boolean>
  delete(fileKey: string): Promise<void>
}

export interface PrivateDocumentStorageOptions {
  root?: string
  encryptionKey?: string | Buffer
}

function decodeEncryptionKey(value: string | Buffer | undefined): Buffer {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) throw new Error('Private document encryption key must be 32 bytes.')
    return Buffer.from(value)
  }

  const encoded = value?.trim()
  if (!encoded) {
    throw new Error('PRIVATE_DOCUMENT_ENCRYPTION_KEY is required.')
  }

  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(encoded)) {
    key = Buffer.from(encoded, 'hex')
  } else {
    const base64 = encoded.startsWith('base64:') ? encoded.slice('base64:'.length) : encoded
    key = Buffer.from(base64, 'base64')
  }

  if (key.length !== 32) {
    throw new Error(
      'PRIVATE_DOCUMENT_ENCRYPTION_KEY must be a 32-byte key encoded as base64 or 64-character hex.',
    )
  }
  return key
}

function resolveStorageRoot(value: string | undefined): string {
  const root = value?.trim()
  if (!root) throw new Error('PRIVATE_DOCUMENT_ROOT is required.')
  if (!isAbsolute(root)) throw new Error('PRIVATE_DOCUMENT_ROOT must be an absolute path.')
  return resolve(root)
}

function resolveFilePath(root: string, fileKey: string): string {
  const match = STORAGE_KEY_PATTERN.exec(fileKey)
  if (!match) throw new Error('Invalid private document storage key.')

  const candidate = resolve(root, match[1]!, match[2]!)
  if (!candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Invalid private document storage key.')
  }
  return candidate
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export function createPrivateDocumentStorage(
  options: PrivateDocumentStorageOptions = {},
): PrivateDocumentStorage {
  const root = resolveStorageRoot(options.root ?? process.env.PRIVATE_DOCUMENT_ROOT)
  const encryptionKey = decodeEncryptionKey(
    options.encryptionKey ?? process.env.PRIVATE_DOCUMENT_ENCRYPTION_KEY,
  )

  async function write(
    plaintext: Uint8Array,
  ): Promise<{ key: string; encryptedSizeBytes: number }> {
    const id = randomUUID()
    const shard = id.slice(0, 2)
    const key = `private/v1/${shard}/${id}.bin`
    const directory = join(root, shard)
    const finalPath = resolveFilePath(root, key)
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    })
    cipher.setAAD(Buffer.from(key, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext])

    await ensurePrivateDirectory(root)
    await ensurePrivateDirectory(directory)

    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(payload)
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, finalPath)
      await chmod(finalPath, 0o600)
      return { key, encryptedSizeBytes: payload.length }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function read(fileKey: string): Promise<Buffer> {
    const path = resolveFilePath(root, fileKey)
    const payload = await readFile(path)
    if (payload.length < HEADER_LENGTH || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Private document file has an invalid format.')
    }

    const ivStart = MAGIC.length
    const tagStart = ivStart + IV_LENGTH
    const ciphertextStart = tagStart + AUTH_TAG_LENGTH
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      payload.subarray(ivStart, tagStart),
      { authTagLength: AUTH_TAG_LENGTH },
    )
    decipher.setAAD(Buffer.from(fileKey, 'utf8'))
    decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart))
    return Buffer.concat([decipher.update(payload.subarray(ciphertextStart)), decipher.final()])
  }

  async function exists(fileKey: string): Promise<boolean> {
    const path = resolveFilePath(root, fileKey)
    try {
      await access(path, fsConstants.R_OK)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async function deleteFile(fileKey: string): Promise<void> {
    const path = resolveFilePath(root, fileKey)
    await rm(path, { force: true })
  }

  return { write, read, exists, delete: deleteFile }
}
