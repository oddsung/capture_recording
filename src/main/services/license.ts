import { createPublicKey, verify } from 'node:crypto'
import Store from 'electron-store'
import type { LicenseStatus } from '@shared/types'

/**
 * Offline Pro-license verification. Keys are issued by scripts/license-issue.mjs
 * (or later by the payment provider's webhook) and signed with an Ed25519 key
 * whose PRIVATE half lives outside the repo (~/.capture-recording-keys).
 * Format: CR1.<payloadB64url>.<sigB64url> — the signature covers the UTF-8
 * bytes of the payload segment string, so no JSON canonicalization is involved.
 */
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAR3S68Vf/YK3559/5amNzE6F/z28TWa3SP5vMwcu59Bo='

interface LicensePayload {
  v: 1
  plan: 'pro'
  email: string
  issued: string
  id: string
}

export function verifyLicenseKey(key: string): LicensePayload | null {
  try {
    const parts = key.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'CR1') return null
    const [, payloadB64, sigB64] = parts
    const pub = createPublicKey({
      key: Buffer.from(PUBLIC_KEY_B64, 'base64'),
      format: 'der',
      type: 'spki'
    })
    if (!verify(null, Buffer.from(payloadB64, 'utf8'), pub, Buffer.from(sigB64, 'base64url'))) {
      return null
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (payload?.v !== 1 || payload?.plan !== 'pro' || typeof payload.email !== 'string') {
      return null
    }
    return payload as LicensePayload
  } catch {
    return null
  }
}

export class LicenseService {
  private store = new Store<{ key: string }>({ name: 'license', defaults: { key: '' } })
  private payload: LicensePayload | null = null

  constructor() {
    const stored = this.store.get('key')
    if (stored) this.payload = verifyLicenseKey(stored)
  }

  isPro(): boolean {
    return this.payload !== null
  }

  status(): LicenseStatus {
    return this.payload
      ? { plan: 'pro', email: this.payload.email, issuedAt: this.payload.issued }
      : { plan: 'free' }
  }

  activate(key: string): { ok: boolean; status: LicenseStatus } {
    const payload = verifyLicenseKey(key)
    if (!payload) return { ok: false, status: this.status() }
    this.store.set('key', key.trim())
    this.payload = payload
    return { ok: true, status: this.status() }
  }

  deactivate(): LicenseStatus {
    this.store.set('key', '')
    this.payload = null
    return this.status()
  }
}
