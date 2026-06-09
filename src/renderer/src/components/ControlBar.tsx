import { useTranslation } from 'react-i18next'
import type { CaptureStatus } from '@shared/types'

interface Props {
  status: CaptureStatus
  onStart: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  onManual: () => void
}

export function ControlBar({
  status,
  onStart,
  onStop,
  onPause,
  onResume,
  onManual
}: Props): JSX.Element {
  const { t } = useTranslation()
  const recording = status === 'recording'
  const paused = status === 'paused'

  return (
    <section className="control-bar">
      {status === 'idle' ? (
        <button className="btn primary big" onClick={onStart}>
          ● {t('controls.start')}
        </button>
      ) : (
        <button className="btn danger big" onClick={onStop}>
          ■ {t('controls.stop')}
        </button>
      )}

      <div className="control-row">
        {recording && (
          <button className="btn" onClick={onPause}>
            {t('controls.pause')}
          </button>
        )}
        {paused && (
          <button className="btn" onClick={onResume}>
            {t('controls.resume')}
          </button>
        )}
        <button className="btn ghost" onClick={onManual} disabled={status === 'idle'}>
          📷 {t('controls.manual')}
        </button>
      </div>

      <p className="hint">{t('controls.hint')}</p>
    </section>
  )
}
