import { useRef, useState } from 'react'
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

/**
 * Reordering uses pointer events (not native HTML5 drag & drop — drag initiation
 * proved unreliable in this Electron/Windows environment). The caption bar is the
 * drag handle; the thumbnail stays click-to-edit. A floating ghost card follows
 * the cursor and an accent bar marks where the card will land.
 */
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
  const [overId, setOverId] = useState<string | null>(null)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  // Press tracking lives in a ref: a press only becomes a drag past a small
  // movement threshold, so plain clicks on the caption bar stay inert.
  const pressRef = useRef<{ id: string; x0: number; y0: number; active: boolean } | null>(null)
  const dupCount = items.filter((i) => i.flagged === 'duplicate').length
  const dragIdx = dragId ? items.findIndex((i) => i.id === dragId) : -1
  const dragItem = dragId ? items.find((i) => i.id === dragId) : undefined

  const clearDrag = (): void => {
    setDragId(null)
    setOverId(null)
    setGhostPos(null)
  }

  /** Card id under the pointer (the ghost is pointer-events: none, so it never hits). */
  const cardIdAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)
    const card = el?.closest('[data-card-id]') as HTMLElement | null
    return card?.dataset.cardId ?? null
  }

  const reorderTo = (sourceId: string, targetId: string): void => {
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, sourceId)
    onReorder(ids)
  }

  const onHandleDown = (e: React.PointerEvent<HTMLElement>, id: string): void => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.del')) return // delete button stays a plain click
    e.preventDefault() // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId)
    pressRef.current = { id, x0: e.clientX, y0: e.clientY, active: false }
  }

  const onHandleMove = (e: React.PointerEvent<HTMLElement>): void => {
    const d = pressRef.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 6) return
      d.active = true
      setDragId(d.id)
    }
    setGhostPos({ x: e.clientX, y: e.clientY })
    const over = cardIdAt(e.clientX, e.clientY)
    if (over !== overId) setOverId(over)
  }

  const onHandleUp = (e: React.PointerEvent<HTMLElement>): void => {
    const d = pressRef.current
    pressRef.current = null
    if (d?.active) {
      const target = cardIdAt(e.clientX, e.clientY)
      if (target && target !== d.id) reorderTo(d.id, target)
    }
    clearDrag()
  }

  const onHandleCancel = (): void => {
    pressRef.current = null
    clearDrag()
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

      {items.length > 1 && <p className="reorder-hint">{t('gallery.reorderHint')}</p>}

      {items.length === 0 ? (
        <div className="empty">{t('gallery.empty')}</div>
      ) : (
        <div className="grid">
          {items.map((item, idx) => (
            <figure
              key={item.id}
              data-card-id={item.id}
              className={[
                'card',
                item.flagged === 'duplicate' ? 'dup' : '',
                dragId === item.id ? 'dragging' : '',
                overId === item.id && dragId && dragId !== item.id
                  ? dragIdx < idx
                    ? 'drop-after'
                    : 'drop-before'
                  : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="thumb-wrap" onClick={() => onOpen(item.id)}>
                {item.thumbnailDataUrl ? (
                  <img
                    draggable={false}
                    src={item.thumbnailDataUrl}
                    alt={t('gallery.step', { index: item.index })}
                  />
                ) : (
                  <div className="thumb-fallback" />
                )}
                <span className="mode-chip">{t(`captureMode.${item.captureMode}`)}</span>
                {item.flagged === 'duplicate' && <span className="dup-chip">{t('gallery.duplicate')}</span>}
              </div>
              {/* The caption bar is the drag handle; the image above stays click-to-edit. */}
              <figcaption
                title={t('gallery.reorderHint')}
                onPointerDown={(e) => onHandleDown(e, item.id)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleCancel}
              >
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

      {dragItem && ghostPos && (
        <div className="drag-ghost" style={{ left: ghostPos.x, top: ghostPos.y }}>
          {dragItem.thumbnailDataUrl ? (
            <img src={dragItem.thumbnailDataUrl} alt="" />
          ) : (
            <div className="thumb-fallback" />
          )}
          <div className="g-cap">
            <span className="badge">{dragItem.index || '•'}</span>
            <span className="cap">{dragItem.caption ?? t('gallery.step', { index: dragItem.index })}</span>
          </div>
        </div>
      )}
    </section>
  )
}
