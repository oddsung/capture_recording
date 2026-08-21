/**
 * Issue a Pro license key for a customer.
 *
 *   node scripts/license-issue.mjs <email> [privateKeyPath]
 *
 * Key format: CR1.<payloadB64url>.<sigB64url> — the Ed25519 signature is over
 * the UTF-8 bytes of the payload segment STRING (not re-serialized JSON), so
 * verification never depends on JSON canonicalization.
 */
import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const email = process.argv[2]
if (!email) {
  console.error('usage: node scripts/license-issue.mjs <email> [privateKeyPath]')
  process.exit(1)
}
const privPath = process.argv[3] ?? join(os.homedir(), '.capture-recording-keys', 'private.pem')
const key = createPrivateKey(readFileSync(privPath))

const payload = {
  v: 1,
  plan: 'pro',
  email,
  issued: new Date().toISOString().slice(0, 10),
  id: randomUUID().slice(0, 8)
}
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
const sig = sign(null, Buffer.from(payloadB64, 'utf8'), key).toString('base64url')
console.log(`CR1.${payloadB64}.${sig}`)
