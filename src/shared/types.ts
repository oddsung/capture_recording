/**
 * Shared domain types used across main / preload / renderer.
 * Keep this file free of any runtime/Node/Electron imports so it can be
 * imported safely from the renderer.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type ExportFormat = 'png' | 'jpg' | 'pdf' | 'html' | 'md' | 'docx' | 'pptx'

export interface ExportOptions {
  outDir: string
  formats: ExportFormat[]
  numbering: boolean
  captions: boolean
}

export interface ExportResult {
  ok: boolean
  outDir: string
  files: string[]
  count: number
  error?: string
}

export type CaptureMode = 'fullscreen' | 'window' | 'element' | 'cursor'
export type CaptureTrigger = 'click' | 'text-commit' | 'manual' | 'key'
export type OutputFormat = 'png' | 'jpg' | 'webp'
export type Language = 'en' | 'ko'
export type Theme = 'light' | 'dark' | 'system'

/** Element info resolved by the native UIA helper (populated from M2). */
export interface ElementInfo {
  bounds: Rect // screen coordinates
  controlType: string // e.g. "Button", "Edit"
  name?: string // accessible name — caption material
  isEditable?: boolean
}

/** A non-destructive annotation layer drawn on top of the raw image (M4). */
export type Annotation =
  | { id: string; kind: 'border'; rect: Rect; color: string; thickness: number; radius: number }
  | { id: string; kind: 'rect'; rect: Rect; color: string; thickness: number }
  | { id: string; kind: 'arrow'; from: Point; to: Point; color: string; thickness: number }
  | { id: string; kind: 'highlight'; rect: Rect; color: string; opacity: number }
  | { id: string; kind: 'blur'; rect: Rect; intensity: number }
  | { id: string; kind: 'text'; at: Point; text: string; color: string; fontSize: number }
  | { id: string; kind: 'badge'; at: Point; label: string; color: string }

/** One captured step. Display image = rawImage + rendered annotation layers. */
export interface CaptureItem {
  id: string
  index: number // auto step number
  rawImagePath: string // absolute path to the original screenshot (non-destructive)
  width: number // raw image pixel dimensions
  height: number
  thumbnailDataUrl?: string // small preview for the gallery
  capturedAt: number
  trigger: CaptureTrigger
  captureMode: CaptureMode
  displayId: number
  clickPoint?: Point
  element?: ElementInfo
  caption?: string
  annotations: Annotation[]
  flagged?: 'duplicate' | 'deleted'
  pHash?: string
}

export interface SessionState {
  id: string
  createdAt: number
  items: CaptureItem[]
}

export type CaptureStatus = 'idle' | 'recording' | 'paused'

/** Settings — every feature is individually toggleable per the project plan. */
export interface AppSettings {
  language: Language
  theme: Theme
  startWithWindows: boolean
  minimizeToTray: boolean

  // Triggers
  triggers: {
    leftClick: boolean
    rightClick: boolean
    doubleClick: boolean
    drag: boolean
    textCommit: boolean
    debounceMs: number
    captureDelayMs: number // wait after action so the UI settles before grabbing
  }

  // Capture
  capture: {
    mode: CaptureMode
    format: OutputFormat
    quality: number // 1-100 for jpg/webp
    scale: number // 1 = native; <1 downscale
    maxWidth: number // 0 = unlimited
    maxHeight: number // 0 = unlimited
    elementPadding: number // px around element in 'element' mode
    cursorAreaSize: number // px box around cursor in 'cursor' mode
    fastGrab: boolean // use the fast GDI sidecar grab (captures pre-navigation frame)
  }

  // Red border (composited, not baked into raw)
  border: {
    color: string
    thickness: number
    radius: number
    padding: number
    showLivePreview: boolean
  }

  // Capture feedback effect (never appears in the saved image)
  effect: {
    flash: boolean
    flashStyle: 'flash' | 'pulse' | 'frame'
    sound: boolean
    toast: boolean
  }

  // Optional features (all toggleable)
  features: {
    autoNumber: boolean
    autoCaption: boolean
    sensitiveBlur: boolean
    duplicateDetection: boolean
    duplicateThreshold: number // 0-1 perceptual-hash similarity
  }

  // Global hotkeys (Electron accelerator strings)
  hotkeys: {
    enabled: boolean
    startStop: string
    pauseResume: string
    manualCapture: string
    deleteLast: string
  }

  // Capture exclusions (process names, case-insensitive)
  exclusions: string[]

  // Storage
  storage: {
    saveDir: string // '' = default userData/sessions
    fileNamePattern: string
    autoSaveSec: number
  }

  // Export defaults — user picks formats at export time
  exportFormats: {
    images: boolean
    pdf: boolean
    htmlMarkdown: boolean
    office: boolean
  }
}
