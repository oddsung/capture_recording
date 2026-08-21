import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import type { AppSettings, CaptureItem, ExportOptions } from '@shared/types'
import { IPC } from '@shared/ipc'
import { AppController } from './controller'

let controller: AppController | null = null

function registerIpc(c: AppController): void {
  ipcMain.handle(IPC.GET_SETTINGS, () => c.settings.get())
  ipcMain.handle(IPC.UPDATE_SETTINGS, (_e, patch: Partial<AppSettings>) =>
    c.settings.update(patch)
  )
  ipcMain.handle(IPC.GET_STATUS, () => c.getStatus())
  ipcMain.handle(IPC.START, () => c.start())
  ipcMain.handle(IPC.STOP, () => c.stop())
  ipcMain.handle(IPC.PAUSE, () => c.pause())
  ipcMain.handle(IPC.RESUME, () => c.resume())
  ipcMain.handle(IPC.MANUAL_CAPTURE, () => c.manualCapture())
  ipcMain.handle(IPC.GET_ITEMS, () => c.session.list())
  ipcMain.handle(IPC.CLEAR_SESSION, () => c.session.clear())
  ipcMain.handle(IPC.DELETE_ITEM, (_e, id: string) => c.session.delete(id))
  ipcMain.handle(IPC.UPDATE_ITEM, (_e, id: string, patch: Partial<CaptureItem>) =>
    c.updateItem(id, patch)
  )
  ipcMain.handle(IPC.REORDER, (_e, ids: string[]) => c.reorder(ids))
  ipcMain.handle(IPC.CLEAN_DUPLICATES, () => c.cleanDuplicates())
  ipcMain.handle(IPC.GET_RAW, (_e, id: string) => c.getRaw(id))
  ipcMain.handle(IPC.CHOOSE_EXPORT_DIR, () => c.chooseExportDir())
  ipcMain.handle(IPC.EXPORT_SESSION, (_e, options: ExportOptions) => c.exportSession(options))
  ipcMain.handle(IPC.OPEN_SAVE_DIR, () => shell.openPath(c.session.getRawDir()))
  ipcMain.handle(IPC.OPEN_PATH, (_e, p: string) => shell.openPath(p))
  ipcMain.handle(IPC.LIST_PROFILES, () => c.listProfiles())
  ipcMain.handle(IPC.SAVE_PROFILE, (_e, name: string) => c.saveProfile(name))
  ipcMain.handle(IPC.APPLY_PROFILE, (_e, name: string) => c.applyProfile(name))
  ipcMain.handle(IPC.DELETE_PROFILE, (_e, name: string) => c.deleteProfile(name))

  // Broadcast settings changes to the renderers.
  c.settings.onChange((settings) => {
    c.windows.getPanel()?.webContents.send(IPC.ON_SETTINGS_CHANGED, settings)
    c.windows.getHud()?.webContents.send(IPC.ON_SETTINGS_CHANGED, settings)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => controller?.windows.showPanel())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.doosung.capturerecording')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    controller = new AppController()
    registerIpc(controller)
    controller.init()

    app.on('activate', () => controller?.windows.showPanel())

    // Headless smoke test: exercise the full capture pipeline without a human click.
    if (process.env.CR_SMOKE === '1') {
      setTimeout(async () => {
        try {
          const c = controller!
          c.start()
          console.log(`[SMOKE] helperAvailable=${c.helperAvailable()}`)
          console.log(`[SMOKE] fastGrab frame=${await c.debugGrab(100, 100)}`)
          // Two identical captures -> the second should be flagged as a duplicate (pHash).
          await c.captureAt({ x: 100, y: 100 }, 'click')
          await c.captureAt({ x: 100, y: 100 }, 'click')
          let items = c.session.list()
          console.log(
            `[SMOKE] captures=${items.length} flags=${items.map((i) => i.flagged ?? '-').join(',')}`
          )
          console.log(
            `[SMOKE] filenames=${items.map((i) => i.rawImagePath.split(/[\\/]/).pop()).join(' | ')}`
          )

          // updateItem: caption + annotation round-trip.
          const first = items[0]
          const upd = c.updateItem(first.id, {
            caption: '테스트 캡션',
            annotations: [
              ...first.annotations,
              { id: 'a1', kind: 'rect', rect: { x: 10, y: 10, width: 60, height: 40 }, color: '#ff0000', thickness: 3 }
            ]
          })
          console.log(`[SMOKE] updateItem caption=${upd?.caption} ann=${upd?.annotations.length}`)

          // getRaw: full image data URL.
          const raw = await c.getRaw(first.id)
          console.log(`[SMOKE] getRaw ok=${!!raw} dim=${raw?.width}x${raw?.height} bytes=${raw?.dataUrl.length}`)

          // reorder (reverse) + renumber.
          const rev = c.reorder(items.map((i) => i.id).reverse())
          console.log(`[SMOKE] reorder steps=${rev.map((i) => i.index).join(',')}`)

          // cleanDuplicates.
          const dupBefore = c.session.list().filter((i) => i.flagged === 'duplicate').length
          const remaining = await c.cleanDuplicates()
          console.log(`[SMOKE] dupBefore=${dupBefore} afterClean=${remaining.length}`)

          // persistence + crash recovery file.
          c.session.save()
          await new Promise((r) => setTimeout(r, 300))
          const sf = join(app.getPath('userData'), 'sessions', 'current', 'session.json')
          console.log(`[SMOKE] sessionFile exists=${existsSync(sf)}`)

          // ---- M5: flatten + export ----
          const survivor = remaining[0]
          c.updateItem(survivor.id, {
            annotations: [
              ...survivor.annotations,
              { id: 't1', kind: 'text', at: { x: 60, y: 60 }, text: '한글 주석', color: '#0a84ff', fontSize: 40 },
              { id: 'ar1', kind: 'arrow', from: { x: 120, y: 220 }, to: { x: 420, y: 320 }, color: '#ff3b30', thickness: 6 },
              { id: 'bl1', kind: 'blur', rect: { x: 500, y: 500, width: 320, height: 130 }, intensity: 10 },
              { id: 'bd1', kind: 'badge', at: { x: 240, y: 130 }, label: '1', color: '#ff3b30' }
            ]
          })
          const fsm = require('node:fs')
          const outDir = join(require('node:os').tmpdir(), 'cr-export-test')
          fsm.rmSync(outDir, { recursive: true, force: true })
          const res = await c.exportSession({
            outDir,
            formats: ['png', 'pdf', 'html', 'md', 'docx', 'pptx'],
            numbering: true,
            captions: true
          })
          console.log(`[SMOKE] export ok=${res.ok} count=${res.count} files=${res.files.length} err=${res.error ?? '-'}`)
          const head = (p: string, n: number): string => {
            try {
              return fsm.readFileSync(p).slice(0, n).toString('latin1')
            } catch {
              return ''
            }
          }
          console.log(`[SMOKE] pdf=${head(join(outDir, 'guide.pdf'), 5)} docx=${head(join(outDir, 'guide.docx'), 2)} pptx=${head(join(outDir, 'guide.pptx'), 2)}`)
          console.log(`[SMOKE] html=${head(join(outDir, 'guide.html'), 9).includes('<!doctype')} md=${existsSync(join(outDir, 'guide.md'))} stepPng=${existsSync(join(outDir, 'steps', 'step-01.png'))} asset=${existsSync(join(outDir, 'images', 'step-01.png'))}`)

          // ---- M6: hotkeys / exclusions / deleteLast / profiles ----
          const gs = require('electron').globalShortcut
          const hk = c.settings.get().hotkeys
          console.log(`[SMOKE] hotkeys startStop=${gs.isRegistered(hk.startStop)} manual=${gs.isRegistered(hk.manualCapture)}`)

          const q = await c.debugQuery(100, 100)
          const proc = q?.window?.process
          if (proc) {
            c.settings.update({ exclusions: [proc] })
            const before = c.session.list().length
            await c.captureAt({ x: 100, y: 100 }, 'click')
            console.log(`[SMOKE] exclusion proc=${proc} skipped=${c.session.list().length === before}`)
            c.settings.update({ exclusions: [] })
          }

          const n0 = c.session.list().length
          await c.deleteLast()
          console.log(`[SMOKE] deleteLast ${n0}->${c.session.list().length}`)

          const savedList = c.saveProfile('smoke-test')
          const applied = c.applyProfile('smoke-test')
          const afterDel = c.deleteProfile('smoke-test')
          console.log(`[SMOKE] profiles saved=${savedList.includes('smoke-test')} applied=${!!applied} cleaned=${!afterDel.includes('smoke-test')}`)
          console.log('[SMOKE] ok')
        } catch (e) {
          console.error('[SMOKE] error', e)
        } finally {
          setTimeout(() => app.quit(), 600)
        }
      }, 1500)
    }
  })

  // Keep running in the tray when all windows are closed.
  app.on('window-all-closed', () => {
    // Intentionally do not quit on Windows/Linux — app lives in the tray.
  })

  app.on('before-quit', () => controller?.shutdown())
}
