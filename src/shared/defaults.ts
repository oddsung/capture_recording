import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ko',
  theme: 'system',
  startWithWindows: false,
  minimizeToTray: true,

  triggers: {
    leftClick: true,
    rightClick: false,
    doubleClick: false,
    drag: false,
    textCommit: true,
    debounceMs: 350,
    captureDelayMs: 0
  },

  capture: {
    mode: 'fullscreen',
    format: 'png',
    quality: 90,
    scale: 1,
    maxWidth: 0,
    maxHeight: 0,
    elementPadding: 8,
    cursorAreaSize: 480,
    fastGrab: true
  },

  border: {
    color: '#ff3b30',
    thickness: 4,
    radius: 4,
    padding: 4,
    showLivePreview: true
  },

  effect: {
    flash: true,
    flashStyle: 'frame',
    sound: false,
    toast: true
  },

  features: {
    autoNumber: true,
    autoCaption: true,
    sensitiveBlur: false,
    duplicateDetection: true,
    duplicateThreshold: 0.92
  },

  hotkeys: {
    enabled: true,
    startStop: 'CommandOrControl+Shift+R',
    pauseResume: 'CommandOrControl+Shift+P',
    manualCapture: 'CommandOrControl+Shift+S',
    deleteLast: 'CommandOrControl+Shift+Z'
  },

  exclusions: [],

  storage: {
    saveDir: '',
    // Placeholders: {timestamp} {seq} {index} {id}. Zero-padded so name-sort = capture order.
    fileNamePattern: 'step-{seq}-{timestamp}',
    autoSaveSec: 30
  },

  exportFormats: {
    images: true,
    pdf: true,
    htmlMarkdown: false,
    office: false
  }
}
