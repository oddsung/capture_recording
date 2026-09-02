/** IPC channel names and the typed API shape exposed to the renderer. */

import type {
  AppSettings,
  CaptureItem,
  CaptureStatus,
  ExportOptions,
  ExportResult,
  LicenseStatus,
  PickerInfo,
  Rect,
  RegionPick
} from './types'

export const IPC = {
  // renderer -> main (invoke)
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',
  GET_STATUS: 'capture:getStatus',
  START: 'capture:start',
  START_WITH_REGION: 'capture:startWithRegion',
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
  COPY_ITEM_IMAGE: 'item:copyImage',
  SAVE_ITEM_IMAGE: 'item:saveImage',
  CHOOSE_EXPORT_DIR: 'export:chooseDir',
  GET_EXPORT_DEFAULTS: 'export:defaults',
  EXPORT_SESSION: 'export:run',
  OPEN_SAVE_DIR: 'shell:openSaveDir',
  OPEN_PATH: 'shell:openPath',
  LIST_PROFILES: 'profiles:list',
  SAVE_PROFILE: 'profiles:save',
  APPLY_PROFILE: 'profiles:apply',
  DELETE_PROFILE: 'profiles:delete',
  GET_LICENSE: 'license:get',
  ACTIVATE_LICENSE: 'license:activate',
  DEACTIVATE_LICENSE: 'license:deactivate',
  PICKER_INFO: 'picker:info',
  PICKER_DONE: 'picker:done', // picker window -> main (send)

  // main -> renderer (send)
  ON_STATUS_CHANGED: 'evt:statusChanged',
  ON_CAPTURE_ADDED: 'evt:captureAdded',
  ON_CAPTURE_FLASH: 'evt:captureFlash', // to overlay window
  ON_REGION_CHANGED: 'evt:regionChanged', // to overlay window: recording-area frame (DIP, overlay-relative) or null
  ON_SETTINGS_CHANGED: 'evt:settingsChanged',
  ON_ITEM_REMOVED: 'evt:itemRemoved',
  ON_LICENSE_CHANGED: 'evt:licenseChanged'
} as const

/** Shape of the API bridged through preload as `window.api`. */
export interface CaptureApi {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getStatus(): Promise<CaptureStatus>
  start(): Promise<CaptureStatus>
  /** Open the recording-area picker; starts recording once an area is chosen (idle if cancelled). */
  startWithRegion(): Promise<CaptureStatus>
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
  /** Flattened step image (annotations + crop, free-plan watermark) → clipboard. */
  copyItemImage(id: string): Promise<boolean>
  /** Flattened step image → PNG via save dialog; resolves to the path or null if cancelled. */
  saveItemImage(id: string): Promise<string | null>
  chooseExportDir(): Promise<string | null>
  /** Default export location: base = storage.saveDir or Documents\<product>; suggested = base + timestamped subfolder. */
  getExportDefaults(): Promise<{ baseDir: string; suggestedDir: string }>
  exportSession(options: ExportOptions): Promise<ExportResult>
  openSaveDir(): Promise<void>
  openPath(path: string): Promise<void>
  listProfiles(): Promise<string[]>
  saveProfile(name: string): Promise<string[]>
  applyProfile(name: string): Promise<AppSettings | undefined>
  deleteProfile(name: string): Promise<string[]>
  getLicense(): Promise<LicenseStatus>
  activateLicense(key: string): Promise<{ ok: boolean; status: LicenseStatus }>
  deactivateLicense(): Promise<LicenseStatus>

  onStatusChanged(cb: (status: CaptureStatus) => void): () => void
  onCaptureAdded(cb: (item: CaptureItem) => void): () => void
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  onItemRemoved(cb: (id: string) => void): () => void
  onLicenseChanged(cb: (status: LicenseStatus) => void): () => void
}

/** Bridged as `window.overlay` in the capture-feedback overlay window. */
export interface OverlayApi {
  onFlash(cb: (payload: { flash: boolean; style: string; toast: boolean }) => void): () => void
  onRegion(cb: (rect: Rect | null) => void): () => void
}

/** Bridged as `window.picker` in the recording-area picker windows. */
export interface PickerApi {
  getInfo(displayId: number): Promise<PickerInfo>
  done(result: RegionPick): void
}
