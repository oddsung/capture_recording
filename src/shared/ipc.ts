/** IPC channel names and the typed API shape exposed to the renderer. */

import type { AppSettings, CaptureItem, CaptureStatus, ExportOptions, ExportResult } from './types'

export const IPC = {
  // renderer -> main (invoke)
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',
  GET_STATUS: 'capture:getStatus',
  START: 'capture:start',
  STOP: 'capture:stop',
  PAUSE: 'capture:pause',
  RESUME: 'capture:resume',
  MANUAL_CAPTURE: 'capture:manual',
  GET_ITEMS: 'session:getItems',
  CLEAR_SESSION: 'session:clear',
  DELETE_ITEM: 'session:deleteItem',
  UPDATE_ITEM: 'session:updateItem',
  REORDER: 'session:reorder',
  CLEAN_DUPLICATES: 'session:cleanDuplicates',
  GET_RAW: 'session:getRaw',
  CHOOSE_EXPORT_DIR: 'export:chooseDir',
  EXPORT_SESSION: 'export:run',
  OPEN_SAVE_DIR: 'shell:openSaveDir',
  OPEN_PATH: 'shell:openPath',
  LIST_PROFILES: 'profiles:list',
  SAVE_PROFILE: 'profiles:save',
  APPLY_PROFILE: 'profiles:apply',
  DELETE_PROFILE: 'profiles:delete',

  // main -> renderer (send)
  ON_STATUS_CHANGED: 'evt:statusChanged',
  ON_CAPTURE_ADDED: 'evt:captureAdded',
  ON_CAPTURE_FLASH: 'evt:captureFlash', // to overlay window
  ON_SETTINGS_CHANGED: 'evt:settingsChanged',
  ON_ITEM_REMOVED: 'evt:itemRemoved'
} as const

/** Shape of the API bridged through preload as `window.api`. */
export interface CaptureApi {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getStatus(): Promise<CaptureStatus>
  start(): Promise<CaptureStatus>
  stop(): Promise<CaptureStatus>
  pause(): Promise<CaptureStatus>
  resume(): Promise<CaptureStatus>
  manualCapture(): Promise<void>
  getItems(): Promise<CaptureItem[]>
  clearSession(): Promise<void>
  deleteItem(id: string): Promise<void>
  updateItem(id: string, patch: Partial<CaptureItem>): Promise<CaptureItem | undefined>
  reorder(ids: string[]): Promise<CaptureItem[]>
  cleanDuplicates(): Promise<CaptureItem[]>
  getRaw(id: string): Promise<{ dataUrl: string; width: number; height: number } | null>
  chooseExportDir(): Promise<string | null>
  exportSession(options: ExportOptions): Promise<ExportResult>
  openSaveDir(): Promise<void>
  openPath(path: string): Promise<void>
  listProfiles(): Promise<string[]>
  saveProfile(name: string): Promise<string[]>
  applyProfile(name: string): Promise<AppSettings | undefined>
  deleteProfile(name: string): Promise<string[]>

  onStatusChanged(cb: (status: CaptureStatus) => void): () => void
  onCaptureAdded(cb: (item: CaptureItem) => void): () => void
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  onItemRemoved(cb: (id: string) => void): () => void
}
