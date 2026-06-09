import { useTranslation } from 'react-i18next'
import type { CaptureStatus } from '@shared/types'

interface Props {
  status: CaptureStatus
  tab: 'capture' | 'settings'
  onTab: (t: 'capture' | 'settings') => void
}

export function Header({ status, tab, onTab }: Props): JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="header">
      <div className="brand">
        <div className={`status-dot ${status}`} />
        <div>
          <h1>{t('app.title')}</h1>
          <p className="status-label">{t(`status.${status}`)}</p>
        </div>
      </div>
      <nav className="tabs">
        <button className={tab === 'capture' ? 'active' : ''} onClick={() => onTab('capture')}>
          {t('nav.capture')}
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => onTab('settings')}>
          {t('nav.settings')}
        </button>
      </nav>
    </header>
  )
}
