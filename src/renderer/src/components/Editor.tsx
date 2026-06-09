import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stage, Layer, Image as KImage, Rect, Arrow, Text as KText, Circle, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { Annotation, CaptureItem } from '@shared/types'
import { useImage } from '../hooks/useImage'

type Tool = 'select' | 'border' | 'rect' | 'arrow' | 'highlight' | 'blur' | 'text' | 'badge'
const RECT_KINDS = new Set(['border', 'rect', 'highlight', 'blur'])
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#000000', '#ffffff']

function newId(): string {
  return crypto.randomUUID()
}

interface Props {
  item: CaptureItem
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onSaved: (item: CaptureItem) => void
}

export function Editor({ item, index, total, onPrev, onNext, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const img = useImage(src)
  const [annotations, setAnnotations] = useState<Annotation[]>(item.annotations ?? [])
  const [caption, setCaption] = useState(item.caption ?? '')
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ff3b30')
  const [thickness, setThickness] = useState(4)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const drawing = useRef<{ id: string; x: number; y: number } | null>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef<Record<string, Konva.Node>>({})

  // Load the raw image once.
  useEffect(() => {
    let alive = true
    void window.api.getRaw(item.id).then((r) => {
      if (alive && r) setSrc(r.dataUrl)
    })
    return () => {
      alive = false
    }
  }, [item.id])

  // Measure the canvas area.
  useLayoutEffect(() => {
    const measure = (): void => {
      if (wrapRef.current) {
        setBox({ w: wrapRef.current.clientWidth, h: wrapRef.current.clientHeight })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const imgW = item.width || img?.width || 1
  const imgH = item.height || img?.height || 1
  const scale = Math.min(box.w / imgW, box.h / imgH) || 1

  // Attach the transformer to the selected rect-like shape.
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const sel = annotations.find((a) => a.id === selectedId)
    const node = selectedId && sel && RECT_KINDS.has(sel.kind) ? shapeRefs.current[selectedId] : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, annotations])

  // Persist (debounced) whenever annotations/caption change.
  useEffect(() => {
    const handle = setTimeout(() => {
      void window.api.updateItem(item.id, { annotations, caption }).then((updated) => {
        if (updated) onSaved(updated)
      })
    }, 500)
    return () => clearTimeout(handle)
  }, [annotations, caption, item.id, onSaved])

  // Flush the latest edits when leaving this capture (prev/next/close remounts via key).
  const latest = useRef({ annotations, caption })
  latest.current = { annotations, caption }
  useEffect(() => {
    return () => {
      void window.api.updateItem(item.id, latest.current).then((u) => u && onSaved(u))
    }
  }, [item.id, onSaved])

  const addAnn = useCallback((a: Annotation) => setAnnotations((p) => [...p, a]), [])
  const patchAnn = useCallback(
    (id: string, patch: Partial<Annotation>) =>
      setAnnotations((p) => p.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a))),
    []
  )
  const removeSelected = useCallback(() => {
    if (!selectedId) return
    setAnnotations((p) => p.filter((a) => a.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && !typing) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight' && !typing) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, removeSelected, onClose, onPrev, onNext])

  function imgPoint(stage: Konva.Stage | null): { x: number; y: number } {
    const p = stage?.getPointerPosition()
    return { x: (p?.x ?? 0) / scale, y: (p?.y ?? 0) / scale }
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const stage = e.target.getStage()
    if (tool === 'select') {
      if (e.target === stage || e.target.name() === 'bg') setSelectedId(null)
      return
    }
    const pt = imgPoint(stage)
    const id = newId()
    if (tool === 'text') {
      addAnn({ id, kind: 'text', at: pt, text: t('editor.textDefault'), color, fontSize: 28 })
      setSelectedId(id)
      setTool('select')
      return
    }
    if (tool === 'badge') {
      const n = annotations.filter((a) => a.kind === 'badge').length + 1
      addAnn({ id, kind: 'badge', at: pt, label: String(n), color })
      setSelectedId(id)
      setTool('select')
      return
    }
    drawing.current = { id, x: pt.x, y: pt.y }
    if (tool === 'arrow') addAnn({ id, kind: 'arrow', from: pt, to: pt, color, thickness })
    else if (tool === 'highlight')
      addAnn({ id, kind: 'highlight', rect: { x: pt.x, y: pt.y, width: 0, height: 0 }, color: '#ffe14d', opacity: 0.35 })
    else if (tool === 'blur')
      addAnn({ id, kind: 'blur', rect: { x: pt.x, y: pt.y, width: 0, height: 0 }, intensity: 8 })
    else if (tool === 'border')
      addAnn({ id, kind: 'border', rect: { x: pt.x, y: pt.y, width: 0, height: 0 }, color, thickness, radius: 4 })
    else addAnn({ id, kind: 'rect', rect: { x: pt.x, y: pt.y, width: 0, height: 0 }, color, thickness })
    setSelectedId(id)
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const d = drawing.current
    if (!d) return
    const pt = imgPoint(e.target.getStage())
    setAnnotations((anns) =>
      anns.map((a) => {
        if (a.id !== d.id) return a
        if (a.kind === 'arrow') return { ...a, to: pt }
        const x = Math.min(d.x, pt.x)
        const y = Math.min(d.y, pt.y)
        return { ...a, rect: { x, y, width: Math.abs(pt.x - d.x), height: Math.abs(pt.y - d.y) } } as Annotation
      })
    )
  }

  const onMouseUp = (): void => {
    const d = drawing.current
    if (!d) return
    drawing.current = null
    setAnnotations((anns) =>
      anns.filter((a) => {
        if (a.id !== d.id) return true
        if (a.kind === 'arrow') return Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) > 5
        if ('rect' in a) return a.rect.width > 4 && a.rect.height > 4
        return true
      })
    )
    setTool('select')
  }

  const setRef = (id: string) => (node: Konva.Node | null): void => {
    if (node) shapeRefs.current[id] = node
    else delete shapeRefs.current[id]
  }

  const onRectTransform = (id: string) => (e: Konva.KonvaEventObject<Event>): void => {
    const node = e.target as Konva.Rect
    const w = Math.max(4, node.width() * node.scaleX())
    const h = Math.max(4, node.height() * node.scaleY())
    node.scaleX(1)
    node.scaleY(1)
    patchAnn(id, { rect: { x: node.x(), y: node.y(), width: w, height: h } } as Partial<Annotation>)
  }

  const renderAnnotation = (a: Annotation): JSX.Element | null => {
    const common = { draggable: tool === 'select', onClick: () => setSelectedId(a.id), onTap: () => setSelectedId(a.id) }
    switch (a.kind) {
      case 'border':
      case 'rect':
        return (
          <Rect
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x}
            y={a.rect.y}
            width={a.rect.width}
            height={a.rect.height}
            stroke={a.color}
            strokeWidth={a.thickness}
            cornerRadius={a.kind === 'border' ? a.radius : 0}
            {...common}
            onDragEnd={(e) => patchAnn(a.id, { rect: { ...a.rect, x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'highlight':
        return (
          <Rect
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x}
            y={a.rect.y}
            width={a.rect.width}
            height={a.rect.height}
            fill={a.color}
            opacity={a.opacity}
            {...common}
            onDragEnd={(e) => patchAnn(a.id, { rect: { ...a.rect, x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'blur':
        return (
          <Rect
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x}
            y={a.rect.y}
            width={a.rect.width}
            height={a.rect.height}
            fill="rgba(90,90,90,0.55)"
            stroke="#ffffff"
            dash={[6, 4]}
            strokeWidth={1}
            {...common}
            onDragEnd={(e) => patchAnn(a.id, { rect: { ...a.rect, x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'arrow':
        return (
          <Arrow
            key={a.id}
            points={[a.from.x, a.from.y, a.to.x, a.to.y]}
            stroke={a.color}
            fill={a.color}
            strokeWidth={a.thickness}
            pointerLength={a.thickness * 2.5}
            pointerWidth={a.thickness * 2.5}
            {...common}
            onDragEnd={(e) => {
              const nx = e.target.x()
              const ny = e.target.y()
              e.target.position({ x: 0, y: 0 })
              patchAnn(a.id, {
                from: { x: a.from.x + nx, y: a.from.y + ny },
                to: { x: a.to.x + nx, y: a.to.y + ny }
              } as Partial<Annotation>)
            }}
          />
        )
      case 'text':
        return (
          <KText
            key={a.id}
            x={a.at.x}
            y={a.at.y}
            text={a.text}
            fill={a.color}
            fontSize={a.fontSize}
            fontStyle="bold"
            {...common}
            onDragEnd={(e) => patchAnn(a.id, { at: { x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)}
          />
        )
      case 'badge':
        return (
          <Group
            key={a.id}
            x={a.at.x}
            y={a.at.y}
            {...common}
            onDragEnd={(e) => patchAnn(a.id, { at: { x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)}
          >
            <Circle radius={18} fill={a.color} />
            <KText text={a.label} fill="#fff" fontSize={20} fontStyle="bold" x={-18} y={-10} width={36} align="center" />
          </Group>
        )
      default:
        return null
    }
  }

  const selected = annotations.find((a) => a.id === selectedId)

  const tools: { id: Tool; label: string }[] = [
    { id: 'select', label: t('editor.select') },
    { id: 'border', label: t('editor.border') },
    { id: 'rect', label: t('editor.rect') },
    { id: 'arrow', label: t('editor.arrow') },
    { id: 'highlight', label: t('editor.highlight') },
    { id: 'blur', label: t('editor.blur') },
    { id: 'text', label: t('editor.text') },
    { id: 'badge', label: t('editor.badge') }
  ]

  return (
    <div className="editor-modal">
      <div className="editor-head">
        <div className="nav-group">
          <button
            className="btn ghost sm"
            onClick={onPrev}
            disabled={index <= 1}
            title={`${t('editor.prev')} (←)`}
          >
            ‹
          </button>
          <span className="nav-pos">
            {index} / {total}
          </span>
          <button
            className="btn ghost sm"
            onClick={onNext}
            disabled={index >= total}
            title={`${t('editor.next')} (→)`}
          >
            ›
          </button>
        </div>
        <strong>
          {t('gallery.step', { index: item.index })} · {t(`captureMode.${item.captureMode}`)}
        </strong>
        <div className="spacer" />
        <span className="nav-hint">{t('editor.navHint')}</span>
        <button className="btn ghost sm" onClick={removeSelected} disabled={!selectedId}>
          🗑 {t('editor.deleteShape')}
        </button>
        <button className="btn primary sm" onClick={onClose}>
          {t('editor.done')}
        </button>
      </div>

      <div className="editor-tools">
        {tools.map((tl) => (
          <button
            key={tl.id}
            className={`tool ${tool === tl.id ? 'active' : ''}`}
            onClick={() => setTool(tl.id)}
          >
            {tl.label}
          </button>
        ))}
        <span className="divider" />
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => {
              setColor(c)
              if (selected && 'color' in selected) patchAnn(selected.id, { color: c } as Partial<Annotation>)
            }}
          />
        ))}
        <input
          className="thickness"
          type="range"
          min={1}
          max={16}
          value={thickness}
          onChange={(e) => {
            const v = Number(e.target.value)
            setThickness(v)
            if (selected && 'thickness' in selected) patchAnn(selected.id, { thickness: v } as Partial<Annotation>)
          }}
        />
      </div>

      <div className="editor-canvas" ref={wrapRef}>
        {img ? (
          <Stage
            width={imgW * scale}
            height={imgH * scale}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <Layer scaleX={scale} scaleY={scale}>
              <KImage image={img} width={imgW} height={imgH} name="bg" />
              {annotations.map(renderAnnotation)}
              <Transformer ref={trRef} rotateEnabled={false} ignoreStroke />
            </Layer>
          </Stage>
        ) : (
          <div className="loading">…</div>
        )}
      </div>

      <div className="editor-foot">
        {selected && 'text' in selected ? (
          <input
            className="caption-input"
            value={selected.text}
            placeholder={t('editor.textDefault')}
            onChange={(e) => patchAnn(selected.id, { text: e.target.value } as Partial<Annotation>)}
          />
        ) : (
          <input
            className="caption-input"
            value={caption}
            placeholder={t('editor.caption')}
            onChange={(e) => setCaption(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}
