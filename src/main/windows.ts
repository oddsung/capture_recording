import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { Point, Rect } from '@shared/types'

const iconPath = join(__dirname, '../../resources/icon.png')

/** Load either the dev server route or the built file for a given HTML entry. */
function loadEntry(win: BrowserWindow, htmlFile: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    const suffix = htmlFile === 'index.html' ? '' : `/${htmlFile}`
    win.loadURL(`${devUrl}${suffix}`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${htmlFile}`))
  }
}

export class WindowManager {
  private panel: BrowserWindow | null = null
  private overlay: BrowserWindow | null = null
  private hud: BrowserWindow | null = null

  createControlPanel(): BrowserWindow {
    const win = new BrowserWindow({
      width: 460,
      height: 720,
      minWidth: 380,
      minHeight: 560,
      show: false,
      title: 'Capture Recording',
      icon: iconPath,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    win.on('ready-to-show', () => win.show())
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Exclude our own window from screen captures (Windows: WDA_EXCLUDEFROMCAPTURE).
    win.setContentProtection(true)

    loadEntry(win, 'index.html')
    this.panel = win
    win.on('closed', () => {
      this.panel = null
    })
    return win
  }

  /** Transparent, click-through, always-on-top overlay for capture feedback. */
  createOverlay(): BrowserWindow {
    const primary = screen.getPrimaryDisplay()
    const win = new BrowserWindow({
      ...primary.bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setContentProtection(true) // flash effect must never appear in captures
    win.setVisibleOnAllWorkspaces(true)

    loadEntry(win, 'overlay.html')
    this.overlay = win
    win.on('closed', () => {
      this.overlay = null
    })
    return win
  }

  /**
   * Small always-on-top recording HUD (rec indicator + pause/stop + hotkey hint).
   * Content-protected so it never appears in captures; NOT click-through — its
   * buttons work, but the controller skips capture triggers landing on it.
   */
  createHud(): BrowserWindow {
    const wa = screen.getPrimaryDisplay().workArea
    const width = 540
    const height = 52
    const win = new BrowserWindow({
      x: Math.round(wa.x + (wa.width - width) / 2),
      y: wa.y + 12,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false, // clicks work, but never steals focus from the recorded app
      hasShadow: false,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setContentProtection(true) // the HUD must never appear in captures
    win.setVisibleOnAllWorkspaces(true)

    loadEntry(win, 'hud.html')
    this.hud = win
    win.on('closed', () => {
      this.hud = null
    })
    return win
  }

  getPanel(): BrowserWindow | null {
    return this.panel
  }

  getOverlay(): BrowserWindow | null {
    return this.overlay
  }

  getHud(): BrowserWindow | null {
    return this.hud
  }

  showPanel(): void {
    if (!this.panel) {
      this.createControlPanel()
      return
    }
    if (this.panel.isMinimized()) this.panel.restore()
    this.panel.show()
    this.panel.focus()
  }

  hidePanel(): void {
    this.panel?.hide()
  }

  showHud(): void {
    if (!this.hud) this.createHud()
    this.hud?.showInactive()
    this.hud?.moveTop()
  }

  hideHud(): void {
    this.hud?.hide()
  }

  /** True if a DIP point lands on one of our visible interactive windows (HUD/panel). */
  isPointOnOwnUi(dip: Point): boolean {
    const hit = (win: BrowserWindow | null): boolean => {
      if (!win || win.isDestroyed() || !win.isVisible()) return false
      const b = win.getBounds()
      return dip.x >= b.x && dip.x < b.x + b.width && dip.y >= b.y && dip.y < b.y + b.height
    }
    return hit(this.hud) || hit(this.panel)
  }

  /** Reposition the overlay to the target display, then make it visible on top. */
  positionOverlayOn(bounds: Rect): void {
    if (!this.overlay) return
    this.overlay.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    })
    // Re-assert top-most each time: focus changes (e.g. navigating in a browser)
    // can otherwise let the overlay fall behind, so the flash wouldn't be seen.
    this.overlay.setAlwaysOnTop(true, 'screen-saver')
    if (!this.overlay.isVisible()) this.overlay.showInactive()
    this.overlay.moveTop()
  }
}
