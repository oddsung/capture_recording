/**
 * Recording HUD — the small always-on-top pill shown while recording:
 * pulsing rec dot + elapsed time + pause/resume + stop + stop-hotkey hint.
 * The window is content-protected (never appears in captures) and clicks on it
 * are ignored by the capture triggers in the main process.
 */
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import type { AppSettings, CaptureStatus } from '@shared/types'
import i18n from './i18n'

/** Human-friendly accelerator (Electron's CommandOrControl → Ctrl on Windows). */
function prettyAccel(accel: string): string {
  return accel.replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl')
}

function fmtElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

function Hud(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const accumRef = useRef(0) // ms recorded before the current run
  const startRef = useRef<number | null>(null) // ts when recording (re)started
  const prevRef = useRef<CaptureStatus>('idle')

  useEffect(() => {
    void (async () => {
      setStatus(await window.api.getStatus())
      const s = await window.api.getSettings()
      setSettings(s)
      void i18n.changeLanguage(s.language)
    })()
    const offStatus = window.api.onStatusChanged(setStatus)
    const offSettings = window.api.onSettingsChanged((s) => {
      setSettings(s)
      void i18n.changeLanguage(s.language)
    })
    return () => {
      offStatus()
      offSettings()
    }
  }, [])

  // Elapsed-time bookkeeping across pause/resume (timestamp-based, throttle-safe).
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    if (status === 'recording') {
      if (prev === 'idle') accumRef.current = 0
      startRef.current = Date.now()
    } else if (status === 'paused') {
      if (startRef.current != null) accumRef.current += Date.now() - startRef.current
      startRef.current = null
    } else {
      accumRef.current = 0
      startRef.current = null
      setElapsed(0)
    }
  }, [status])

  useEffect(() => {
    if (status !== 'recording') {
      setElapsed(Math.floor(accumRef.current / 1000))
      return
    }
    const tick = (): void =>
      setElapsed(
        Math.floor(
          (accumRef.current + (startRef.current != null ? Date.now() - startRef.current : 0)) / 1000
        )
      )
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [status])

  const paused = status === 'paused'
  const stopKey =
    settings?.hotkeys.enabled && settings.hotkeys.startStop
      ? prettyAccel(settings.hotkeys.startStop)
      : null
  const captureKey =
    settings?.hotkeys.enabled && settings.hotkeys.manualCapture
      ? prettyAccel(settings.hotkeys.manualCapture)
      : null

  return (
    <div className="hud">
      <span className={`dot ${paused ? 'paused' : 'rec'}`} />
      <span className="label">{paused ? t('hud.paused') : t('hud.recording')}</span>
      <span className="time">{fmtElapsed(elapsed)}</span>
      <span className="spacer" />
      <button
        title={captureKey ? t('hud.captureHint', { key: captureKey }) : t('hud.captureHintNoKey')}
        onClick={() => window.api.manualCapture()}
      >
        📷 {t('hud.capture')}
      </button>
      {paused ? (
        <button onClick={() => window.api.resume()}>▶ {t('hud.resume')}</button>
      ) : (
        <button onClick={() => window.api.pause()}>⏸ {t('hud.pause')}</button>
      )}
      <button className="stop" onClick={() => window.api.stop()}>
        ■ {t('hud.stop')}
      </button>
      {stopKey && <span className="hint">{t('hud.stopHint', { key: stopKey })}</span>}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('hud-root') as HTMLElement).render(
  <React.StrictMode>
    <Hud />
  </React.StrictMode>
)
