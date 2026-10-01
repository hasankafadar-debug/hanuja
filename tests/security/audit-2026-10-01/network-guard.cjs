// Preload for local verification: block network sockets, DNS and HTTP.
// Only tsx's local named pipe is allowed; it carries process-control IPC.
const blocked = () => { throw new Error('OFFLINE_AUDIT_NETWORK_BLOCKED') }
const os = require('node:os')
const path = require('node:path')
const uid = process.geteuid ? process.geteuid() : os.userInfo().username
const pipeDirectory = path.join(os.tmpdir(), `tsx-${uid}`) + path.sep
const pipePrefix = process.platform === 'win32' ? `\\\\?\\pipe\\${pipeDirectory}` : pipeDirectory
function isTsxPipe(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const target = typeof first === 'object' ? first?.path : first
  return typeof target === 'string' && target.startsWith(pipePrefix) && /^\d+\.pipe$/.test(target.slice(pipePrefix.length))
}
function pipeOnly(original) {
  return function (...args) {
    if (!isTsxPipe(args)) return blocked()
    return original.apply(this, args)
  }
}
for (const name of ['node:net', 'node:tls']) {
  const module = require(name)
  module.connect = name === 'node:net' ? pipeOnly(module.connect) : blocked
  module.createConnection = name === 'node:net' ? pipeOnly(module.createConnection) : blocked
  if (name === 'node:net') module.Socket.prototype.connect = pipeOnly(module.Socket.prototype.connect)
}
for (const name of ['node:http', 'node:https']) {
  const module = require(name)
  module.request = blocked
  module.get = blocked
}
const dns = require('node:dns')
for (const name of Object.keys(dns)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dns[name] === 'function') dns[name] = blocked
}
for (const name of Object.keys(dns.promises)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dns.promises[name] === 'function') dns.promises[name] = blocked
}
// Vite asks DNS for localhost before creating its transform server. Answer
// locally without consulting DNS; TCP connections remain forbidden.
function localAddress(hostname, options = {}) {
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return blocked()
  const family = hostname === '::1' || options.family === 6 ? 6 : 4
  const answer = { address: family === 6 ? '::1' : '127.0.0.1', family }
  return options.all ? [answer] : answer
}
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {} }
  const answer = localAddress(hostname, options)
  queueMicrotask(() => Array.isArray(answer) ? callback(null, answer) : callback(null, answer.address, answer.family))
}
dns.promises.lookup = async (hostname, options) => localAddress(hostname, options)
require('node:dgram').createSocket = blocked
globalThis.fetch = blocked
