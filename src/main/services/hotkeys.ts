import { globalShortcut } from 'electron'
import type { SettingsStore } from './settings'

export interface HotkeyActions {
  startStop: () => void
  pauseResume: () => void
  manualCapture: () => void
  deleteLast: () => void
}

/** Registers global shortcuts from settings; re-registers when settings change. */
export class HotkeyManager {
  constructor(
    private readonly settings: SettingsStore,
    private readonly actions: HotkeyActions
  ) {}

  refresh(): void {
    globalShortcut.unregisterAll()
    const h = this.settings.get().hotkeys
    if (!h.enabled) return
    this.tryRegister(h.startStop, this.actions.startStop)
    this.tryRegister(h.pauseResume, this.actions.pauseResume)
    this.tryRegister(h.manualCapture, this.actions.manualCapture)
    this.tryRegister(h.deleteLast, this.actions.deleteLast)
  }

  dispose(): void {
    globalShortcut.unregisterAll()
  }

  private tryRegister(accelerator: string, cb: () => void): void {
    if (!accelerator) return
    try {
      globalShortcut.register(accelerator, cb)
    } catch (err) {
      console.warn(`[hotkeys] failed to register "${accelerator}":`, err)
    }
  }
}
