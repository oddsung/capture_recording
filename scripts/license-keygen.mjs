/**
 * One-time Ed25519 keypair generation for license signing.
 *
 *   node scripts/license-keygen.mjs [outDir]
 *
 * The PRIVATE key is written OUTSIDE the repo (default: ~/.capture-recording-keys)
 * and must never be committed — back it up somewhere safe. The printed
 * PUBLIC_KEY_B64 goes into src/main/services/license.ts.
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const dir = process.argv[2] ?? join(os.homedir(), '.capture-recording-keys')
const privPath = join(dir, 'private.pem')
if (existsSync(privPath)) {
  console.error(`Refusing to overwrite existing key: ${privPath}`)
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dir, { recursive: true })
writeFileSync(privPath, privateKey.export({ format: 'pem', type: 'pkcs8' }))
const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
writeFileSync(join(dir, 'public.spki.b64'), spki)

console.log('private key:', privPath)
console.log('PUBLIC_KEY_B64:', spki)
