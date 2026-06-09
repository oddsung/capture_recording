import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Rect } from '@shared/types'

export interface HelperElement {
  bounds: Rect // physical px, global
  controlType: string
  name: string
  editable: boolean
}
export interface HelperWindow {
  bounds: Rect // physical px, global
  process: string
}
export interface ElementQueryResult {
  element: HelperElement | null
  window: HelperWindow | null
}

/** Result of a fast GDI screen grab: a temp PNG covering a physical-px rect. */
export interface CaptureFrame {
  file: string
  x: number
  y: number
  w: number
  h: number
}

type HelperMessage = { id?: number; ok?: boolean; [k: string]: unknown }

interface Pending {
  resolve: (msg: HelperMessage | null) => void
  timer: NodeJS.Timeout
}

/** Resolve the native-helper.exe path in dev and packaged builds. */
function resolveHelperPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'native-helper.exe')]
    : [join(app.getAppPath(), 'native-helper', 'bin', 'native-helper.exe')]
  return candidates.find((p) => existsSync(p)) ?? null
}

type RawRect = { x: number; y: number; w: number; h: number }
const toRect = (r: RawRect): Rect => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** Map a raw helper message (flat x/y/w/h) into Rect-based element/window types. */
function mapResult(msg: HelperMessage | null): ElementQueryResult | null {
  if (!msg?.ok) return null
  const e = msg.element as (RawRect & { controlType: string; name: string; editable: boolean }) | null
  const w = msg.window as (RawRect & { process: string }) | null
  return {
    element: e
      ? { bounds: toRect(e), controlType: e.controlType, name: e.name, editable: e.editable }
      : null,
    window: w ? { bounds: toRect(w), process: w.process } : null
  }
}

/**
 * Client for the C# UIA sidecar. Spawns the helper, sends line-delimited JSON
 * requests, and resolves responses by id. Degrades gracefully: if the helper is
 * missing or slow, queries resolve to null and the capture pipeline falls back.
 */
export class NativeHelperClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private available = false
  private restartTimer: NodeJS.Timeout | null = null
  private disposed = false

  start(): boolean {
    const exe = resolveHelperPath()
    if (!exe) {
      console.warn('[native-helper] exe not found — element detection disabled')
      return false
    }
    try {
      this.proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      console.error('[native-helper] spawn failed:', err)
      return false
    }

    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (d: string) => console.error('[native-helper:stderr]', d.trim()))
    this.proc.on('exit', (code) => {
      this.available = false
      this.failAllPending()
      if (!this.disposed) {
        console.warn(`[native-helper] exited (code ${code}); restarting in 1s`)
        this.scheduleRestart()
      }
    })
    this.proc.on('error', (err) => {
      console.error('[native-helper] process error:', err)
      this.available = false
    })

    this.available = true
    return true
  }

  isAvailable(): boolean {
    return this.available
  }

  /** Query the UIA element + window at a physical screen point. */
  async query(physX: number, physY: number, timeoutMs = 500): Promise<ElementQueryResult | null> {
    const msg = await this.request(
      { cmd: 'elementFromPoint', x: Math.round(physX), y: Math.round(physY) },
      timeoutMs
    )
    return mapResult(msg)
  }

  /** Query the currently focused UIA element (for text-commit detection). */
  async queryFocused(timeoutMs = 500): Promise<ElementQueryResult | null> {
    return mapResult(await this.request({ cmd: 'focusedElement' }, timeoutMs))
  }

  /** Fast GDI grab of a physical-pixel rect; returns the temp PNG descriptor. */
  async captureScreen(
    x: number,
    y: number,
    w: number,
    h: number,
    timeoutMs = 1500
  ): Promise<CaptureFrame | null> {
    const msg = await this.request(
      { cmd: 'capture', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
      timeoutMs
    )
    if (!msg?.ok || typeof msg.file !== 'string') return null
    return {
      file: msg.file,
      x: msg.x as number,
      y: msg.y as number,
      w: msg.w as number,
      h: msg.h as number
    }
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<HelperMessage | null> {
    if (!this.available || !this.proc) return Promise.resolve(null)
    const id = this.nextId++
    return new Promise<HelperMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      try {
        this.proc!.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(null)
      }
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.failAllPending()
    try {
      this.proc?.stdin.end()
      this.proc?.kill()
    } catch {
      /* ignore */
    }
    this.proc = null
    this.available = false
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let msg: HelperMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(msg.id)
    p.resolve(msg)
  }

  private failAllPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(null)
    }
    this.pending.clear()
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.disposed) this.start()
    }, 1000)
  }
}
