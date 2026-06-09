import { randomUUID } from 'node:crypto'
import { promises as fs, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CaptureItem } from '@shared/types'

type Listener = (item: CaptureItem) => void

/**
 * Holds the current recording session. Raw screenshots live on disk; this tracks
 * the ordered list of capture items + metadata and persists them to session.json
 * (debounced autosave) for crash recovery.
 */
export class SessionStore {
  readonly id = randomUUID()
  readonly createdAt = Date.now()
  private items: CaptureItem[] = []
  private addListeners = new Set<Listener>()
  private readonly sessionFile: string
  private saveTimer: NodeJS.Timeout | null = null
  private seq = 0

  constructor(private readonly rawDir: string) {
    this.sessionFile = join(dirname(rawDir), 'session.json')
  }

  getRawDir(): string {
    return this.rawDir
  }

  /** Restore a previously saved session (crash recovery). */
  load(): void {
    try {
      if (!existsSync(this.sessionFile)) return
      const data = JSON.parse(readFileSync(this.sessionFile, 'utf8'))
      if (Array.isArray(data?.items)) {
        this.items = (data.items as CaptureItem[]).filter((i) => i.flagged !== 'deleted')
        this.seq = this.items.length // continue the filename sequence after a reload
      }
    } catch (err) {
      console.error('[session] load failed:', err)
    }
  }

  list(): CaptureItem[] {
    return this.items.filter((i) => i.flagged !== 'deleted')
  }

  getById(id: string): CaptureItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  add(item: CaptureItem): void {
    this.items.push(item)
    this.scheduleSave()
    for (const l of this.addListeners) l(item)
  }

  nextIndex(): number {
    return this.list().length + 1
  }

  /** Monotonic per-session capture counter (for ordered filenames). */
  nextSeq(): number {
    return ++this.seq
  }

  /** Merge a partial patch (annotations/caption/flagged/index) into an item. */
  updateItem(id: string, patch: Partial<CaptureItem>): CaptureItem | undefined {
    const item = this.items.find((i) => i.id === id)
    if (!item) return undefined
    Object.assign(item, patch)
    this.scheduleSave()
    return item
  }

  /** Reorder visible items to match `orderedIds`, then renumber steps 1..n. */
  reorder(orderedIds: string[]): CaptureItem[] {
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    const visible = this.list()
    visible.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    const deleted = this.items.filter((i) => i.flagged === 'deleted')
    this.items = [...visible, ...deleted]
    this.renumber()
    this.scheduleSave()
    return this.list()
  }

  async delete(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.flagged = 'deleted'
    this.renumber()
    this.scheduleSave()
    try {
      await fs.rm(item.rawImagePath, { force: true })
    } catch {
      /* best effort */
    }
  }

  /** Delete all items flagged as duplicates. Returns remaining items. */
  async cleanDuplicates(): Promise<CaptureItem[]> {
    const dupes = this.items.filter((i) => i.flagged === 'duplicate')
    for (const d of dupes) {
      d.flagged = 'deleted'
      try {
        await fs.rm(d.rawImagePath, { force: true })
      } catch {
        /* best effort */
      }
    }
    this.renumber()
    this.scheduleSave()
    return this.list()
  }

  async clear(): Promise<void> {
    this.items = []
    this.scheduleSave()
    try {
      await fs.rm(this.rawDir, { recursive: true, force: true })
      await fs.mkdir(this.rawDir, { recursive: true })
    } catch {
      /* best effort */
    }
  }

  rawPathFor(id: string, ext: string): string {
    return join(this.rawDir, `${id}.${ext}`)
  }

  onAdded(listener: Listener): () => void {
    this.addListeners.add(listener)
    return () => this.addListeners.delete(listener)
  }

  private renumber(): void {
    let n = 1
    for (const item of this.list()) {
      if (item.index > 0) item.index = n
      n++
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 1200)
  }

  /** Persist now (also called on a debounce timer). */
  save(): void {
    this.saveTimer = null
    try {
      const payload = JSON.stringify({
        id: this.id,
        createdAt: this.createdAt,
        items: this.items.filter((i) => i.flagged !== 'deleted')
      })
      fs.mkdir(dirname(this.sessionFile), { recursive: true }).then(
        () => writeFileSync(this.sessionFile, payload),
        () => {
          /* ignore */
        }
      )
    } catch (err) {
      console.error('[session] save failed:', err)
    }
  }
}
