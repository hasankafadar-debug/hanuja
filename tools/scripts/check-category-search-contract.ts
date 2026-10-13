import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import {
  getMeilisearchConfig,
  buildMeilisearchHeaders,
  ensureIndex,
  waitForMeilisearchTask,
} from '../../api/lib/meilisearch'
async function main() {
  const { baseUrl, apiKey } = getMeilisearchConfig(),
    headers = buildMeilisearchHeaders(apiKey),
    index = `category_contract_${randomUUID().replaceAll('-', '')}`
  async function request(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${baseUrl}/${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Search contract HTTP ${response.status}`)
    return response.json()
  }
  async function task(path: string, body: unknown, method = 'POST') {
    const result = (await request(path, body, method)) as { taskUid: number }
    await waitForMeilisearchTask(baseUrl, apiKey, result.taskUid)
  }
  try {
    const version = (await request('version')) as { pkgVersion: string }
    assert.equal(version.pkgVersion, '1.49.0', 'Run on the pinned production engine')
    // Concurrent index creation also exercises async index_already_exists handling.
    await Promise.all([
      ensureIndex(index, 'id', { baseUrl, apiKey }),
      ensureIndex(index, 'id', { baseUrl, apiKey }),
    ])
    await task(
      `indexes/${index}/settings`,
      {
        filterableAttributes: ['stock', 'hacim_ml_stokta', 'beden_stokta', 'properties.color'],
        faceting: { maxValuesPerFacet: 1000 },
      },
      'PATCH',
    )
    await task(`indexes/${index}/documents`, [
      { id: 'range', stock: 2, hacim_ml_stokta: [50, 200], properties: {} },
      { id: 'red', stock: 2, beden_stokta: ['M', 'M', 'L'], properties: { color: 'red' } },
      { id: 'blue', stock: 3, beden_stokta: ['L'], properties: { color: 'blue' } },
      { id: 'zero', stock: 0, beden_stokta: [], properties: { color: 'blue' } },
    ])
    const search = (filter: string, facets?: string[]) =>
      request(`indexes/${index}/search`, {
        q: '',
        filter,
        ...(facets ? { facets } : {}),
      }) as Promise<{
        hits: Array<{ id: string }>
        facetDistribution?: Record<string, Record<string, number>>
      }>
    assert.equal((await search('hacim_ml_stokta 90 TO 110')).hits.length, 0)
    assert.equal((await search('hacim_ml_stokta 50 TO 50')).hits.length, 1)
    assert.equal((await search('beden_stokta = "M" AND properties.color = "blue"')).hits.length, 0)
    assert.equal((await search('beden_stokta = "L" AND properties.color = "blue"')).hits.length, 1)
    assert.equal((await search('', ['beden_stokta'])).facetDistribution?.beden_stokta?.M, 1)
    assert.equal((await search('')).hits.length, 4)
    assert.equal((await search('stock > 0')).hits.length, 3)
    await task(`indexes/${index}/documents`, [
      { id: 'red', stock: 0, beden_stokta: [], properties: { color: 'red' } },
    ])
    assert.equal((await search('beden_stokta = "M"')).hits.length, 0)
    console.log(JSON.stringify({ version: version.pkgVersion, contractPassed: true, checks: 8 }))
  } finally {
    const response = await fetch(`${baseUrl}/indexes/${index}`, { method: 'DELETE', headers })
    if (response.ok) {
      const result = (await response.json()) as { taskUid: number }
      await waitForMeilisearchTask(baseUrl, apiKey, result.taskUid)
    }
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Search contract failed')
  process.exitCode = 1
})
