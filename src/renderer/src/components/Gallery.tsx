import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CaptureItem } from '@shared/types'

interface Props {
  items: CaptureItem[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onClear: () => void
  onOpenFolder: () => void
  onReorder: (ids: string[]) => void
  onCleanDuplicates: () => void
  onExport: () => void
}

export function Gallery({
  items,
  onOpen,
  onDelete,
  onClear,
  onOpenFolder,
  onReorder,
  onCleanDuplicates,
  onExport
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [dragId, setDragId] = useState<string | null>(null)
  const dupCount = items.filter((i) => i.flagged === 'duplicate').length

  const drop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    onReorder(ids)
    setDragId(null)
  }

  return (
    <section className="gallery">
      <div className="gallery-head">
        <h2>
          {t('gallery.title')}{' '}
          <span className="muted">· {t('gallery.count', { count: items.length })}</span>
        </h2>
        <div className="gallery-actions">
          {dupCount > 0 && (
            <button className="btn ghost sm warn" onClick={onCleanDuplicates}>
              {t('gallery.cleanDuplicates', { count: dupCount })}
            </button>
          )}
          <button className="btn primary sm" disabled={items.length === 0} onClick={onExport}>
            {t('gallery.export')}
          </button>
          <button className="btn ghost sm" onClick={onOpenFolder}>
            {t('gallery.openFolder')}
          </button>
          <button
            className="btn ghost sm"
            disabled={items.length === 0}
            onClick={() => {
              if (confirm(t('gallery.confirmClear'))) onClear()
            }}
          >
            {t('gallery.clear')}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">{t('gallery.empty')}</div>
      ) : (
        <div className="grid">
          {items.map((item) => (
            <figure
              key={item.id}
              className={`card ${item.flagged === 'duplicate' ? 'dup' : ''}`}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(item.id)}
            >
              <div className="thumb-wrap" onClick={() => onOpen(item.id)}>
                {item.thumbnailDataUrl ? (
                  <img src={item.thumbnailDataUrl} alt={t('gallery.step', { index: item.index })} />
                ) : (
                  <div className="thumb-fallback" />
                )}
                <span className="mode-chip">{t(`captureMode.${item.captureMode}`)}</span>
                {item.flagged === 'duplicate' && <span className="dup-chip">{t('gallery.duplicate')}</span>}
              </div>
              <figcaption>
                <span className="badge">{item.index || '•'}</span>
                <span className="cap">{item.caption ?? t('gallery.step', { index: item.index })}</span>
                <button
                  className="del"
                  title={t('gallery.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(item.id)
                  }}
                >
                  ✕
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}
