import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, CaptureItem, CaptureStatus, ExportOptions } from '@shared/types'
import { IPC, type CaptureApi } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CaptureApi = {
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC.UPDATE_SETTINGS, patch),
  getStatus: () => ipcRenderer.invoke(IPC.GET_STATUS),
  start: () => ipcRenderer.invoke(IPC.START),
  stop: () => ipcRenderer.invoke(IPC.STOP),
  pause: () => ipcRenderer.invoke(IPC.PAUSE),
  resume: () => ipcRenderer.invoke(IPC.RESUME),
  manualCapture: () => ipcRenderer.invoke(IPC.MANUAL_CAPTURE),
  getItems: () => ipcRenderer.invoke(IPC.GET_ITEMS),
  clearSession: () => ipcRenderer.invoke(IPC.CLEAR_SESSION),
  deleteItem: (id: string) => ipcRenderer.invoke(IPC.DELETE_ITEM, id),
  updateItem: (id: string, patch: Partial<CaptureItem>) =>
    ipcRenderer.invoke(IPC.UPDATE_ITEM, id, patch),
  reorder: (ids: string[]) => ipcRenderer.invoke(IPC.REORDER, ids),
  cleanDuplicates: () => ipcRenderer.invoke(IPC.CLEAN_DUPLICATES),
  getRaw: (id: string) => ipcRenderer.invoke(IPC.GET_RAW, id),
  chooseExportDir: () => ipcRenderer.invoke(IPC.CHOOSE_EXPORT_DIR),
  exportSession: (options: ExportOptions) => ipcRenderer.invoke(IPC.EXPORT_SESSION, options),
  openSaveDir: () => ipcRenderer.invoke(IPC.OPEN_SAVE_DIR),
  openPath: (path: string) => ipcRenderer.invoke(IPC.OPEN_PATH, path),
  listProfiles: () => ipcRenderer.invoke(IPC.LIST_PROFILES),
  saveProfile: (name: string) => ipcRenderer.invoke(IPC.SAVE_PROFILE, name),
  applyProfile: (name: string) => ipcRenderer.invoke(IPC.APPLY_PROFILE, name),
  deleteProfile: (name: string) => ipcRenderer.invoke(IPC.DELETE_PROFILE, name),

  onStatusChanged: (cb: (s: CaptureStatus) => void) => subscribe(IPC.ON_STATUS_CHANGED, cb),
  onCaptureAdded: (cb: (i: CaptureItem) => void) => subscribe(IPC.ON_CAPTURE_ADDED, cb),
  onSettingsChanged: (cb: (s: AppSettings) => void) => subscribe(IPC.ON_SETTINGS_CHANGED, cb),
  onItemRemoved: (cb: (id: string) => void) => subscribe(IPC.ON_ITEM_REMOVED, cb)
}

/** Overlay window listens for flash events here. */
const overlayApi = {
  onFlash: (cb: (payload: { flash: boolean; style: string; toast: boolean }) => void) =>
    subscribe(IPC.ON_CAPTURE_FLASH, cb)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('overlay', overlayApi)
} else {
  // @ts-ignore fallback when context isolation is disabled
  window.api = api
  // @ts-ignore
  window.overlay = overlayApi
}
