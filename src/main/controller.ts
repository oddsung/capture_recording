import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, screen } from 'electron'
import type {
  CaptureItem,
  CaptureStatus,
  CaptureTrigger,
  ExportOptions,
  ExportResult,
  Point,
  Rect
} from '@shared/types'
import { IPC } from '@shared/ipc'
import { SettingsStore } from './services/settings'
import { SessionStore } from './services/session'
import { CaptureService, displayPhysicalRect } from './services/capture'
import { similarity } from './services/phash'
import { exportSession } from './services/export'
import { GlobalHookService, type KeyKind } from './services/globalHook'
import { HotkeyManager } from './services/hotkeys'
import {
  NativeHelperClient,
  type ElementQueryResult,
  type HelperElement
} from './services/nativeHelper'
import { WindowManager } from './windows'
import { TrayManager } from './tray'

/** A frame frozen by the sidecar GDI grab: raw PNG bytes + its physical-px rect. */
type CapturedFrame = { buffer: Buffer; dp: Rect }

/** Convert raw OS (physical) coordinates to Electron DIP coordinates (Windows). */
function toDip(raw: Point): Point {
  const s = screen as unknown as { screenToDipPoint?: (p: Point) => Point }
  if (typeof s.screenToDipPoint === 'function') return s.screenToDipPoint(raw)
  return raw
}

/** Convert Electron DIP coordinates to raw OS (physical) coordinates (Windows). */
function toPhysical(dip: Point): Point {
  const s = screen as unknown as { dipToScreenPoint?: (p: Point) => Point }
  if (typeof s.dipToScreenPoint === 'function') return s.dipToScreenPoint(dip)
  return dip
}

function sameElement(a: HelperElement | null | undefined, b: HelperElement | null | undefined): boolean {
  if (!a || !b) return false
  return (
    a.controlType === b.controlType &&
    a.name === b.name &&
    Math.abs(a.bounds.x - b.bounds.x) < 4 &&
    Math.abs(a.bounds.y - b.bounds.y) < 4 &&
    Math.abs(a.bounds.width - b.bounds.width) < 4 &&
    Math.abs(a.bounds.height - b.bounds.height) < 4
  )
}

export class AppController {
  readonly settings = new SettingsStore()
  readonly session: SessionStore
  private readonly capture: CaptureService
  private readonly hook: GlobalHookService
  private readonly helper = new NativeHelperClient()
  private readonly hotkeys: HotkeyManager
  readonly windows = new WindowManager()
  private readonly tray: TrayManager
  private status: CaptureStatus = 'idle'
  // Captures are processed one-at-a-time (never dropped). Frames are frozen at
  // press time, so deferring the heavy image work keeps each image correct.
  private captureQueue: Promise<void> = Promise.resolve()

  // Text-commit tracking: one focused-element query per focus session.
  private editDirty = false
  private focusResolved = false
  private activeEdit: ElementQueryResult | null = null

  // Pre-grab started on mousedown (captures the pre-navigation state).
  private pendingPress: {
    point: Point
    at: number
    frame: Promise<CapturedFrame | null>
    query: Promise<ElementQueryResult | null>
  } | null = null

  constructor() {
    const rawDir = join(app.getPath('userData'), 'sessions', 'current', 'raw')
    this.session = new SessionStore(rawDir)
    this.capture = new CaptureService(this.settings, this.session)
    this.hook = new GlobalHookService(
      this.settings,
      (raw) => this.handleClick(raw),
      (kind) => this.handleKey(kind),
      (raw) => this.handlePress(raw)
    )
    this.tray = new TrayManager({
      onShow: () => this.windows.showPanel(),
      onStart: () => this.start(),
      onStop: () => this.stop(),
      onQuit: () => this.shutdown(),
      getStatus: () => this.status
    })
    this.hotkeys = new HotkeyManager(this.settings, {
      startStop: () => this.toggleStartStop(),
      pauseResume: () => this.togglePauseResume(),
      manualCapture: () => void this.manualCapture(),
      deleteLast: () => void this.deleteLast()
    })
  }

  init(): void {
    this.session.load() // crash recovery
    this.windows.createControlPanel()
    this.windows.createOverlay()
    this.tray.create()
    this.helper.start()
    this.hotkeys.refresh()
    this.applyLoginItem()
    this.settings.onChange(() => {
      this.hotkeys.refresh()
      this.applyLoginItem()
    })
  }

  // ---- profiles ----
  listProfiles(): string[] {
    return this.settings.listProfiles()
  }
  saveProfile(name: string): string[] {
    return this.settings.saveProfile(name)
  }
  applyProfile(name: string): ReturnType<SettingsStore['applyProfile']> {
    return this.settings.applyProfile(name)
  }
  deleteProfile(name: string): string[] {
    return this.settings.deleteProfile(name)
  }

  async deleteLast(): Promise<void> {
    const items = this.session.list()
    const last = items[items.length - 1]
    if (!last) return
    await this.session.delete(last.id)
    this.windows.getPanel()?.webContents.send(IPC.ON_ITEM_REMOVED, last.id)
  }

  private toggleStartStop(): void {
    if (this.status === 'idle') this.start()
    else this.stop()
  }

  private togglePauseResume(): void {
    if (this.status === 'recording') this.pause()
    else if (this.status === 'paused') this.resume()
  }

  private applyLoginItem(): void {
    try {
      app.setLoginItemSettings({ openAtLogin: this.settings.get().startWithWindows })
    } catch {
      /* not supported on this platform */
    }
  }

  private isExcluded(query: ElementQueryResult | null): boolean {
    const proc = query?.window?.process?.toLowerCase()
    if (!proc) return false
    return this.settings
      .get()
      .exclusions.some((e) => e.trim() && proc.includes(e.trim().toLowerCase()))
  }

  // ---- editor / session operations (IPC) ----

  updateItem(id: string, patch: Partial<CaptureItem>): CaptureItem | undefined {
    return this.session.updateItem(id, patch)
  }

  reorder(ids: string[]): CaptureItem[] {
    return this.session.reorder(ids)
  }

  cleanDuplicates(): Promise<CaptureItem[]> {
    return this.session.cleanDuplicates()
  }

  async chooseExportDir(): Promise<string | null> {
    const panel = this.windows.getPanel()
    const res = panel
      ? await dialog.showOpenDialog(panel, {
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  }

  exportSession(options: ExportOptions): Promise<ExportResult> {
    return exportSession(this.session.list(), options)
  }

  async getRaw(id: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
    const item = this.session.getById(id)
    if (!item) return null
    try {
      const buf = await fs.readFile(item.rawImagePath)
      const ext = item.rawImagePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      return {
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        width: item.width,
        height: item.height
      }
    } catch {
      return null
    }
  }

  getStatus(): CaptureStatus {
    return this.status
  }

  start(): CaptureStatus {
    if (this.status === 'recording') return this.status
    this.hook.start()
    this.warmUpHelper()
    this.setStatus('recording')
    return this.status
  }

  /**
   * Fire-and-forget UIA query at the current cursor so the first real click
   * resolves an element. The sidecar's first query pays .NET JIT + UIA init
   * costs, and Chromium only builds its accessibility tree once something
   * queries it — both make the first click's 500ms query miss its deadline.
   */
  private warmUpHelper(): void {
    if (!this.helper.isAvailable()) return
    const phys = toPhysical(screen.getCursorScreenPoint())
    void this.helper.query(phys.x, phys.y, 3000)
  }

  stop(): CaptureStatus {
    this.hook.stop()
    this.resetEditState()
    this.setStatus('idle')
    return this.status
  }

  pause(): CaptureStatus {
    if (this.status !== 'recording') return this.status
    this.setStatus('paused')
    return this.status
  }

  resume(): CaptureStatus {
    if (this.status !== 'paused') return this.status
    this.setStatus('recording')
    return this.status
  }

  async manualCapture(): Promise<void> {
    const dip = screen.getCursorScreenPoint()
    const phys = toPhysical(dip)
    const query = await this.helper.query(phys.x, phys.y)
    await this.doCapture(phys, dip, 'manual', query)
    await this.captureQueue // wait for the queued work to finish
  }

  /** Test hook: capture at an explicit physical point. */
  async captureAt(physPoint: Point, trigger: CaptureTrigger = 'manual'): Promise<void> {
    const query = await this.helper.query(physPoint.x, physPoint.y)
    await this.doCapture(physPoint, toDip(physPoint), trigger, query)
    await this.captureQueue
  }

  /** Test hook: simulate a key event for text-commit flows. */
  feedKey(kind: KeyKind): void {
    this.handleKey(kind)
  }

  helperAvailable(): boolean {
    return this.helper.isAvailable()
  }

  /** Test hook: query the UIA element/window at a physical point. */
  debugQuery(x: number, y: number): Promise<ElementQueryResult | null> {
    return this.helper.query(x, y)
  }

  /** Test hook: run the fast sidecar grab and report the frame. */
  async debugGrab(x: number, y: number): Promise<string> {
    const f = await this.grabFrame(toDip({ x, y }))
    return f ? `${f.dp.width}x${f.dp.height} bytes=${f.buffer.length}` : 'null'
  }

  shutdown(): void {
    this.stop()
    this.hotkeys.dispose()
    this.helper.dispose()
  }

  // ---- click handling (+ commit-on-click-away) ----

  /** On mousedown, eagerly freeze the screen + element (before any navigation). */
  private handlePress(rawPhys: Point): void {
    if (this.status !== 'recording') return
    const dip = toDip(rawPhys)
    this.pendingPress = {
      point: rawPhys,
      at: Date.now(),
      frame: this.grabFrame(dip),
      query: this.helper.query(rawPhys.x, rawPhys.y)
    }
  }

  private takePendingPress(
    rawPhys: Point
  ): { frame: Promise<CapturedFrame | null>; query: Promise<ElementQueryResult | null> } | null {
    const pp = this.pendingPress
    this.pendingPress = null
    if (!pp) return null
    const fresh = Date.now() - pp.at < 2000
    const near = Math.abs(pp.point.x - rawPhys.x) < 12 && Math.abs(pp.point.y - rawPhys.y) < 12
    return fresh && near ? { frame: pp.frame, query: pp.query } : null
  }

  private handleClick(rawPhys: Point): void {
    if (this.status !== 'recording') return
    void (async () => {
      const dipPoint = toDip(rawPhys)
      // Prefer the frame + element captured on mousedown (pre-navigation); the
      // click only commits it. Fall back to grabbing now if there's no press.
      const pp = this.takePendingPress(rawPhys)
      const frame = pp ? await pp.frame : await this.grabFrame(dipPoint)
      const query = pp ? await pp.query : await this.helper.query(rawPhys.x, rawPhys.y)

      if (this.settings.get().triggers.textCommit && this.editDirty && this.activeEdit) {
        const movedAway = !sameElement(query?.element, this.activeEdit.element)
        const edit = this.activeEdit
        this.resetEditState()
        if (movedAway) await this.captureCommit(edit)
      }

      await this.doCapture(rawPhys, dipPoint, 'click', query, frame)
    })()
  }

  // ---- keyboard handling (text-commit) ----

  private handleKey(kind: KeyKind): void {
    if (this.status !== 'recording') return
    if (!this.settings.get().triggers.textCommit) return

    if (kind === 'commit') {
      if (this.editDirty && this.activeEdit) {
        const edit = this.activeEdit
        this.resetEditState()
        void this.captureCommit(edit)
      } else {
        this.resetEditState()
      }
      return
    }

    // kind === 'edit'
    this.editDirty = true
    if (!this.focusResolved) {
      this.focusResolved = true
      void this.helper.queryFocused().then((res) => {
        if (res?.element?.editable) this.activeEdit = res
      })
    }
  }

  private resetEditState(): void {
    this.editDirty = false
    this.focusResolved = false
    this.activeEdit = null
  }

  private async captureCommit(edit: ElementQueryResult): Promise<void> {
    const el = edit.element
    if (!el) return
    const center: Point = {
      x: el.bounds.x + el.bounds.width / 2,
      y: el.bounds.y + el.bounds.height / 2
    }
    await this.doCapture(center, toDip(center), 'text-commit', edit)
  }

  // ---- shared capture path ----

  private async doCapture(
    physPoint: Point,
    dipPoint: Point,
    trigger: CaptureTrigger,
    query: ElementQueryResult | null,
    frame?: CapturedFrame | null
  ): Promise<void> {
    if (trigger !== 'manual' && this.isExcluded(query)) return // excluded app/window

    // Immediate, consistent feedback — fired on the action, not after the (slower)
    // image processing, so every capture flashes regardless of queue depth.
    this.flash(screen.getDisplayNearestPoint(dipPoint).bounds)

    const grabbed = frame !== undefined ? frame : await this.grabFrame(dipPoint)
    // Serialize the heavy work so rapid consecutive clicks are ALL captured
    // (never dropped). The frame is already frozen, so order/correctness hold.
    this.captureQueue = this.captureQueue.then(async () => {
      try {
        const item = await this.capture.capture(
          physPoint,
          dipPoint,
          trigger,
          query,
          grabbed ?? undefined
        )
        if (item) {
          this.flagDuplicate(item)
          this.emitCaptureAdded(item)
        }
      } catch (err) {
        console.error('[capture] failed:', err)
      }
    })
  }

  /** Fast pre-navigation screen grab via the sidecar (null → desktopCapturer fallback). */
  private async grabFrame(dipPoint: Point): Promise<CapturedFrame | null> {
    if (!this.settings.get().capture.fastGrab || !this.helper.isAvailable()) return null
    const dp = displayPhysicalRect(screen.getDisplayNearestPoint(dipPoint))
    const frame = await this.helper.captureScreen(dp.x, dp.y, dp.width, dp.height)
    if (!frame) return null
    try {
      const buffer = await fs.readFile(frame.file)
      void fs.rm(frame.file, { force: true }).catch(() => {})
      return { buffer, dp }
    } catch {
      return null
    }
  }

  /** Flag the new item as a near-duplicate of the previous visible capture. */
  private flagDuplicate(item: CaptureItem): void {
    const f = this.settings.get().features
    if (!f.duplicateDetection || !item.pHash) return
    const visible = this.session.list()
    const idx = visible.findIndex((i) => i.id === item.id)
    const prev = idx > 0 ? visible[idx - 1] : undefined
    if (prev?.pHash && similarity(item.pHash, prev.pHash) >= f.duplicateThreshold) {
      this.session.updateItem(item.id, { flagged: 'duplicate' })
    }
  }

  private flash(bounds: Point & { width: number; height: number }): void {
    const s = this.settings.get().effect
    if (!s.flash && !s.toast) return
    this.windows.positionOverlayOn(bounds)
    const overlay = this.windows.getOverlay()
    overlay?.webContents.send(IPC.ON_CAPTURE_FLASH, {
      flash: s.flash,
      style: s.flashStyle,
      toast: s.toast
    })
  }

  private emitCaptureAdded(item: CaptureItem): void {
    this.windows.getPanel()?.webContents.send(IPC.ON_CAPTURE_ADDED, item)
  }

  private setStatus(status: CaptureStatus): void {
    this.status = status
    this.windows.getPanel()?.webContents.send(IPC.ON_STATUS_CHANGED, status)
    this.tray.refresh()
  }
}
