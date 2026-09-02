import type { CaptureApi, OverlayApi, PickerApi } from '@shared/ipc'

declare global {
  interface Window {
    api: CaptureApi
    overlay: OverlayApi
    picker: PickerApi
  }
}

export {}
