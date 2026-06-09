import Store from 'electron-store'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'

type Listener = (settings: AppSettings) => void

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-merge a partial patch into a base object (arrays are replaced). */
function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = (base as Record<string, unknown>)[key]
    if (isObject(value) && isObject(current)) {
      out[key] = deepMerge(current, value as Record<string, unknown>)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out as T
}

export class SettingsStore {
  private store: Store<AppSettings>
  private profiles: Store<{ profiles: Record<string, AppSettings> }>
  private listeners = new Set<Listener>()

  constructor() {
    this.store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_SETTINGS
    })
    this.profiles = new Store<{ profiles: Record<string, AppSettings> }>({
      name: 'profiles',
      defaults: { profiles: {} }
    })
    // Backfill any keys added in newer versions.
    this.store.store = deepMerge(DEFAULT_SETTINGS, this.store.store)
  }

  // ---- profiles (named setting presets) ----

  listProfiles(): string[] {
    return Object.keys(this.profiles.get('profiles'))
  }

  saveProfile(name: string): string[] {
    const all = this.profiles.get('profiles')
    all[name] = this.store.store
    this.profiles.set('profiles', all)
    return Object.keys(all)
  }

  applyProfile(name: string): AppSettings | undefined {
    const saved = this.profiles.get('profiles')[name]
    if (!saved) return undefined
    const merged = deepMerge(DEFAULT_SETTINGS, saved)
    this.store.store = merged
    this.emit(merged)
    return merged
  }

  deleteProfile(name: string): string[] {
    const all = this.profiles.get('profiles')
    delete all[name]
    this.profiles.set('profiles', all)
    return Object.keys(all)
  }

  get(): AppSettings {
    return this.store.store
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = deepMerge(this.store.store, patch)
    this.store.store = next
    this.emit(next)
    return next
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(settings: AppSettings): void {
    for (const l of this.listeners) l(settings)
  }
}
