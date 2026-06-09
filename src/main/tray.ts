import { join } from 'node:path'
import { app, Menu, Tray, nativeImage } from 'electron'
import type { CaptureStatus } from '@shared/types'

export interface TrayHandlers {
  onShow: () => void
  onStart: () => void
  onStop: () => void
  onQuit: () => void
  getStatus: () => CaptureStatus
}

const trayIconPath = join(__dirname, '../../resources/tray.png')

export class TrayManager {
  private tray: Tray | null = null

  constructor(private readonly handlers: TrayHandlers) {}

  create(): void {
    let image = nativeImage.createFromPath(trayIconPath)
    if (image.isEmpty()) image = nativeImage.createEmpty()
    this.tray = new Tray(image)
    this.tray.setToolTip('Capture Recording')
    this.tray.on('click', () => this.handlers.onShow())
    this.refresh()
  }

  refresh(): void {
    if (!this.tray) return
    const status = this.handlers.getStatus()
    const recording = status === 'recording'
    const menu = Menu.buildFromTemplate([
      { label: 'Capture Recording', enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => this.handlers.onShow() },
      recording
        ? { label: 'Stop capturing', click: () => this.handlers.onStop() }
        : { label: 'Start capturing', click: () => this.handlers.onStart() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.handlers.onQuit()
          app.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
    this.tray.setToolTip(recording ? 'Capture Recording — recording' : 'Capture Recording')
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
