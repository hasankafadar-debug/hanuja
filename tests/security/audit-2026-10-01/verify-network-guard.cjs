require('./network-guard.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const probes = [
  ['TCP', () => require('node:net').connect(9, '127.0.0.1')],
  ['Socket TCP', () => new (require('node:net').Socket)().connect(9, '127.0.0.1')],
  ['TLS', () => require('node:tls').connect(9, '127.0.0.1')],
  ['HTTP', () => require('node:http').get('http://example.invalid')],
  ['HTTPS', () => require('node:https').request('https://example.invalid')],
  ['DNS lookup', () => require('node:dns').lookup('example.invalid', () => {})],
  ['DNS resolve', () => require('node:dns').resolve4('example.invalid', () => {})],
  ['DNS promise lookup', () => require('node:dns').promises.lookup('example.invalid')],
  ['DNS promise resolve', () => require('node:dns').promises.resolve4('example.invalid')],
  ['UDP', () => require('node:dgram').createSocket('udp4')],
  ['fetch', () => fetch('https://example.invalid')],
]
async function main() {
  const results = []
  for (const [name, run] of probes) {
    let caught
    try { await run() } catch (error) { caught = error }
    assert.equal(caught?.message, 'OFFLINE_AUDIT_NETWORK_BLOCKED', name)
    results.push({ name, blocked: true })
  }
  assert.deepEqual(await require('node:dns').promises.lookup('localhost'), { address: '127.0.0.1', family: 4 })
  fs.mkdirSync(path.join(__dirname, 'kanitlar'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, 'kanitlar/network-proof.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), results, localhostResolvedWithoutDNS: true,
    limitations: 'Node preload protection; native binaries are outside this process guard. Verification did not run production DB or network tools.',
  }, null, 2) + '\n')
  console.log(`${results.length} network paths blocked; localhost DNS answered locally`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
