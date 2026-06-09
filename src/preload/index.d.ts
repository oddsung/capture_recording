import type { CaptureApi } from '@shared/ipc'

declare global {
  interface Window {
    api: CaptureApi
    overlay: {
      onFlash: (
        cb: (payload: { flash: boolean; style: string; toast: boolean }) => void
      ) => () => void
    }
  }
}

export {}
