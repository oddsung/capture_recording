import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { CaptureTrigger, Point } from '@shared/types'
import type { SettingsStore } from './settings'

/** libuiohook mouse button codes. */
const BUTTON_LEFT = 1
const BUTTON_RIGHT = 2

const K = UiohookKey
/** Keys that commit a text edit (move focus / submit). */
const COMMIT_KEYS = new Set<number>([K.Tab, K.Enter, K.NumpadEnter])
/** Keys that do NOT represent text entry. Anything else (+ no Ctrl/Alt/Meta) is an edit. */
const NON_EDIT_KEYS = new Set<number>([
  K.Escape, K.CapsLock, K.PageUp, K.PageDown, K.End, K.Home,
  K.ArrowLeft, K.ArrowUp, K.ArrowRight, K.ArrowDown, K.Insert,
  K.F1, K.F2, K.F3, K.F4, K.F5, K.F6, K.F7, K.F8, K.F9, K.F10, K.F11, K.F12,
  K.F13, K.F14, K.F15, K.F16, K.F17, K.F18, K.F19,
  K.NumLock, K.ScrollLock, K.PrintScreen,
  K.Ctrl, K.CtrlRight, K.Alt, K.AltRight, K.Shift, K.ShiftRight, K.Meta, K.MetaRight,
  K.NumpadEnd, K.NumpadArrowDown, K.NumpadPageDown, K.NumpadArrowLeft,
  K.NumpadArrowRight, K.NumpadHome, K.NumpadArrowUp, K.NumpadPageUp, K.NumpadInsert
])

export type TriggerCallback = (rawPoint: Point, trigger: CaptureTrigger) => void
export type KeyKind = 'commit' | 'edit'
export type KeyCallback = (kind: KeyKind) => void
export type PressCallback = (rawPoint: Point) => void

/**
 * Global mouse/keyboard hook (system-wide) via uiohook-napi.
 * Emits debounced click triggers and classified key events (for text-commit
 * detection). Coordinates are RAW OS (physical) pixels.
 */
export class GlobalHookService {
  private running = false
  private listenersBound = false
  private lastTriggerAt = 0

  constructor(
    private readonly settings: SettingsStore,
    private readonly onTrigger: TriggerCallback,
    private readonly onKey: KeyCallback,
    private readonly onPress: PressCallback
  ) {}

  start(): void {
    if (this.running) return
    this.bind()
    uIOhook.start()
    this.running = true
  }

  stop(): void {
    if (!this.running) return
    try {
      uIOhook.stop()
    } catch {
      /* ignore */
    }
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }

  private bind(): void {
    if (this.listenersBound) return
    this.listenersBound = true

    // Pre-grab on press: navigation usually happens on click-release, so freezing
    // the screen + element on mousedown captures the pre-navigation state.
    uIOhook.on('mousedown', (e) => {
      if (!this.running) return
      const t = this.settings.get().triggers
      if (e.button === BUTTON_LEFT && (t.leftClick || t.doubleClick)) {
        this.onPress({ x: e.x, y: e.y })
      } else if (e.button === BUTTON_RIGHT && t.rightClick) {
        this.onPress({ x: e.x, y: e.y })
      }
    })

    uIOhook.on('click', (e) => {
      if (!this.running) return
      const t = this.settings.get().triggers
      const isDouble = (e.clicks ?? 1) >= 2
      if (e.button === BUTTON_LEFT) {
        if (isDouble && t.doubleClick) return this.fire({ x: e.x, y: e.y }, 'click')
        if (t.leftClick) return this.fire({ x: e.x, y: e.y }, 'click')
      } else if (e.button === BUTTON_RIGHT && t.rightClick) {
        return this.fire({ x: e.x, y: e.y }, 'click')
      }
    })

    uIOhook.on('keydown', (e) => {
      if (!this.running) return
      if (!this.settings.get().triggers.textCommit) return
      // Alt/Meta combos are window-switch / OS shortcuts — never text.
      if (e.altKey || e.metaKey) return
      if (COMMIT_KEYS.has(e.keycode)) return this.onKey('commit')
      if (e.ctrlKey) return // Ctrl shortcuts (copy/paste/etc.) are not text entry
      if (!NON_EDIT_KEYS.has(e.keycode)) this.onKey('edit')
    })
  }

  private fire(point: Point, trigger: CaptureTrigger): void {
    const { debounceMs, captureDelayMs } = this.settings.get().triggers
    const now = Date.now()
    if (now - this.lastTriggerAt < debounceMs) return
    this.lastTriggerAt = now
    setTimeout(() => this.onTrigger(point, trigger), Math.max(0, captureDelayMs))
  }
}
