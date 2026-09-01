import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Stage,
  Layer,
  Image as KImage,
  Rect,
  Ellipse,
  Line,
  Arrow,
  Text as KText,
  Circle,
  Group,
  Transformer
} from 'react-konva'
import type Konva from 'konva'
import type { Annotation, CaptureItem, Rect as RectShape } from '@shared/types'
import { useImage } from '../hooks/useImage'
import { Icon } from './icons'

type Tool =
  | 'select'
  | 'border'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'highlight'
  | 'blur'
  | 'mosaic'
  | 'text'
  | 'callout'
  | 'badge'
  | 'crop'
type Snapshot = { annotations: Annotation[]; crop: RectShape | null }

/** Kinds whose geometry is a rect (resizable with the transformer). */
const RECT_KINDS = new Set(['border', 'rect', 'ellipse', 'highlight', 'blur', 'mosaic', 'callout'])
/** Pseudo-id for the (single) non-destructive crop region. */
const CROP_ID = '__crop__'
const PALETTE = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5856d6', '#af52de',
  '#ff2d55', '#a2845e', '#8e8e93', '#000000', '#ffffff', '#1c1d21', '#ffe14d', '#e5e5ea'
]
const TOOL_GROUPS: Tool[][] = [
  ['select'],
  ['border', 'rect', 'ellipse', 'arrow', 'line', 'pen'],
  ['highlight', 'blur', 'mosaic'],
  ['text', 'callout', 'badge'],
  ['crop']
]
const TOOL_KEY: Record<Tool, string> = {
  select: 'v', border: 'b', rect: 'r', ellipse: 'e', arrow: 'a', line: 'l', pen: 'p',
  highlight: 'h', blur: 'm', mosaic: 'k', text: 't', callout: 'q', badge: 'n', crop: 'c'
}
const KEY_TOOL = Object.fromEntries(Object.entries(TOOL_KEY).map(([t, k]) => [k, t])) as Record<string, Tool>

function newId(): string {
  return crypto.randomUUID()
}
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
/** Readable text color for a given background. */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#1c1d21' : '#ffffff'
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
  const [crop, setCrop] = useState<RectShape | null>(item.crop ?? null)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ff3b30')
  const [thickness, setThickness] = useState(4)
  const [fontSize, setFontSize] = useState(28)
  const [fillOn, setFillOn] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null) // null = fit to window
  const [toast, setToast] = useState<string | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const drawing = useRef<{ id: string; x: number; y: number } | null>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef<Record<string, Konva.Node>>({})

  // ---- undo / redo -------------------------------------------------------
  const stateRef = useRef<Snapshot>({ annotations, crop })
  stateRef.current = { annotations, crop }
  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const [histVer, setHistVer] = useState(0)
  /** Call BEFORE a change; records the current state as an undo point. */
  const pushHistory = useCallback(() => {
    past.current.push(stateRef.current)
    if (past.current.length > 100) past.current.shift()
    future.current = []
    setHistVer((v) => v + 1)
  }, [])
  const applySnapshot = (s: Snapshot): void => {
    setAnnotations(s.annotations)
    setCrop(s.crop)
    setSelectedId(null)
    setHistVer((v) => v + 1)
  }
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(stateRef.current)
    applySnapshot(prev)
  }, [])
  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(stateRef.current)
    applySnapshot(next)
  }, [])
  void histVer

  const showToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

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
        setBox({ w: wrapRef.current.clientWidth - 24, h: wrapRef.current.clientHeight - 24 })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const imgW = item.width || img?.width || 1
  const imgH = item.height || img?.height || 1
  const fitScale = Math.min(box.w / imgW, box.h / imgH) || 1
  const scale = zoom ?? fitScale
  const zoomBy = (f: number): void => setZoom(Math.min(4, Math.max(0.1, scale * f)))

  /** Keep a crop rect inside the image bounds. */
  const clampCrop = (r: RectShape): RectShape => {
    const w = Math.max(0, Math.min(r.width, imgW))
    const h = Math.max(0, Math.min(r.height, imgH))
    return {
      x: Math.min(Math.max(0, r.x), imgW - w),
      y: Math.min(Math.max(0, r.y), imgH - h),
      width: w,
      height: h
    }
  }

  // Attach the transformer to the selected rect-like shape (or the crop region).
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const sel = annotations.find((a) => a.id === selectedId)
    const node =
      selectedId === CROP_ID
        ? shapeRefs.current[CROP_ID]
        : selectedId && sel && RECT_KINDS.has(sel.kind)
          ? shapeRefs.current[selectedId]
          : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, annotations, crop])

  // Persist (debounced) whenever annotations/caption/crop change.
  useEffect(() => {
    const handle = setTimeout(() => {
      void window.api.updateItem(item.id, { annotations, caption, crop }).then((updated) => {
        if (updated) onSaved(updated)
      })
    }, 500)
    return () => clearTimeout(handle)
  }, [annotations, caption, crop, item.id, onSaved])

  // Flush the latest edits when leaving this capture (prev/next/close remounts via key).
  const latest = useRef({ annotations, caption, crop })
  latest.current = { annotations, caption, crop }
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
  /** Patch with an undo point (for discrete edits: color, size, fill…). */
  const editAnn = (id: string, patch: Partial<Annotation>): void => {
    pushHistory()
    patchAnn(id, patch)
  }
  const removeSelected = useCallback(() => {
    if (!selectedId) return
    pushHistory()
    if (selectedId === CROP_ID) setCrop(null)
    else setAnnotations((p) => p.filter((a) => a.id !== selectedId))
    setSelectedId(null)
  }, [selectedId, pushHistory])

  const copyImage = useCallback(async () => {
    if (await window.api.copyItemImage(item.id)) showToast(t('editor.copied'))
  }, [item.id, t])
  const saveImage = useCallback(async () => {
    const p = await window.api.saveItemImage(item.id)
    if (p) showToast(t('editor.saved', { path: p }))
  }, [item.id, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (typing) return
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'c' && !typing) {
        e.preventDefault()
        void copyImage()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveImage()
        return
      }
      if (mod) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'Escape') {
        if (selectedId) setSelectedId(null)
        else if (tool !== 'select') setTool('select')
        else onClose()
      } else if (e.key === 'ArrowLeft' && !typing) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight' && !typing) {
        e.preventDefault()
        onNext()
      } else if (!typing && !e.altKey && KEY_TOOL[e.key.toLowerCase()]) {
        setTool(KEY_TOOL[e.key.toLowerCase()])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, tool, removeSelected, onClose, onPrev, onNext, undo, redo, copyImage, saveImage])

  function imgPoint(stage: Konva.Stage | null): { x: number; y: number } {
    const p = stage?.getPointerPosition()
    return { x: (p?.x ?? 0) / scale, y: (p?.y ?? 0) / scale }
  }

  // ---- drawing -----------------------------------------------------------
  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const stage = e.target.getStage()
    if (tool === 'select') {
      if (e.target === stage || e.target.name() === 'bg') setSelectedId(null)
      return
    }
    const pt = imgPoint(stage)
    const id = newId()
    pushHistory()
    if (tool === 'text') {
      addAnn({ id, kind: 'text', at: pt, text: t('editor.textDefault'), color, fontSize })
      setSelectedId(id)
      setTool('select')
      return
    }
    if (tool === 'callout') {
      addAnn({
        id,
        kind: 'callout',
        rect: { x: pt.x, y: pt.y, width: fontSize * 9, height: fontSize * 2.2 },
        text: t('editor.calloutDefault'),
        color: textOn(color),
        fill: color,
        fontSize
      })
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
    if (tool === 'crop') {
      drawing.current = { id: CROP_ID, x: pt.x, y: pt.y }
      setCrop({ x: pt.x, y: pt.y, width: 0, height: 0 })
      setSelectedId(CROP_ID)
      return
    }
    drawing.current = { id, x: pt.x, y: pt.y }
    const rect0 = { x: pt.x, y: pt.y, width: 0, height: 0 }
    const fill = fillOn ? color : undefined
    switch (tool) {
      case 'arrow':
        addAnn({ id, kind: 'arrow', from: pt, to: pt, color, thickness })
        break
      case 'line':
        addAnn({ id, kind: 'line', from: pt, to: pt, color, thickness })
        break
      case 'pen':
        addAnn({ id, kind: 'pen', points: [pt.x, pt.y], color, thickness })
        break
      case 'highlight':
        addAnn({ id, kind: 'highlight', rect: rect0, color: '#ffe14d', opacity: 0.35 })
        break
      case 'blur':
        addAnn({ id, kind: 'blur', rect: rect0, intensity: 8 })
        break
      case 'mosaic':
        addAnn({ id, kind: 'mosaic', rect: rect0, size: 14 })
        break
      case 'border':
        addAnn({ id, kind: 'border', rect: rect0, color, thickness, radius: 4 })
        break
      case 'ellipse':
        addAnn({ id, kind: 'ellipse', rect: rect0, color, thickness, fill })
        break
      default:
        addAnn({ id, kind: 'rect', rect: rect0, color, thickness, fill })
    }
    setSelectedId(id)
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const d = drawing.current
    if (!d) return
    const pt = imgPoint(e.target.getStage())
    if (d.id === CROP_ID) {
      setCrop(
        clampCrop({
          x: Math.min(d.x, pt.x),
          y: Math.min(d.y, pt.y),
          width: Math.abs(pt.x - d.x),
          height: Math.abs(pt.y - d.y)
        })
      )
      return
    }
    setAnnotations((anns) =>
      anns.map((a) => {
        if (a.id !== d.id) return a
        if (a.kind === 'arrow' || a.kind === 'line') return { ...a, to: pt }
        if (a.kind === 'pen') return { ...a, points: [...a.points, pt.x, pt.y] }
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
    if (d.id === CROP_ID) {
      setCrop((c) => (c && c.width > 8 && c.height > 8 ? c : null))
      setTool('select')
      return
    }
    setAnnotations((anns) =>
      anns.filter((a) => {
        if (a.id !== d.id) return true
        if (a.kind === 'arrow' || a.kind === 'line') return Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) > 5
        if (a.kind === 'pen') return a.points.length >= 4
        if ('rect' in a) return a.rect.width > 4 && a.rect.height > 4
        return true
      })
    )
    // The pen stays active for consecutive strokes; other tools return to select.
    if (tool !== 'pen') setTool('select')
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
  const moveRect = (a: Annotation & { rect: RectShape }) => (e: Konva.KonvaEventObject<DragEvent>): void =>
    patchAnn(a.id, { rect: { ...a.rect, x: e.target.x(), y: e.target.y() } } as Partial<Annotation>)

  const renderAnnotation = (a: Annotation): JSX.Element | null => {
    const common = {
      draggable: tool === 'select',
      onClick: () => setSelectedId(a.id),
      onTap: () => setSelectedId(a.id),
      onDragStart: pushHistory,
      onTransformStart: pushHistory
    }
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
            fill={a.kind === 'rect' && a.fill ? hexToRgba(a.fill, 0.3) : undefined}
            cornerRadius={a.kind === 'border' ? a.radius : 0}
            {...common}
            onDragEnd={moveRect(a)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'ellipse': {
        const rx = a.rect.width / 2
        const ry = a.rect.height / 2
        return (
          <Ellipse
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x + rx}
            y={a.rect.y + ry}
            radiusX={rx}
            radiusY={ry}
            stroke={a.color}
            strokeWidth={a.thickness}
            fill={a.fill ? hexToRgba(a.fill, 0.3) : undefined}
            {...common}
            onDragEnd={(e) =>
              patchAnn(a.id, { rect: { ...a.rect, x: e.target.x() - rx, y: e.target.y() - ry } } as Partial<Annotation>)
            }
            onTransformEnd={(e) => {
              const node = e.target as Konva.Ellipse
              const nrx = Math.max(2, node.radiusX() * node.scaleX())
              const nry = Math.max(2, node.radiusY() * node.scaleY())
              node.scaleX(1)
              node.scaleY(1)
              patchAnn(a.id, {
                rect: { x: node.x() - nrx, y: node.y() - nry, width: nrx * 2, height: nry * 2 }
              } as Partial<Annotation>)
            }}
          />
        )
      }
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
            onDragEnd={moveRect(a)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'blur':
      case 'mosaic':
        return (
          <Rect
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x}
            y={a.rect.y}
            width={a.rect.width}
            height={a.rect.height}
            fill={a.kind === 'blur' ? 'rgba(90,90,90,0.55)' : 'rgba(120,120,128,0.6)'}
            stroke="#ffffff"
            dash={a.kind === 'blur' ? [6, 4] : [3, 3]}
            strokeWidth={1}
            strokeScaleEnabled={false}
            {...common}
            onDragEnd={moveRect(a)}
            onTransformEnd={onRectTransform(a.id)}
          />
        )
      case 'arrow':
      case 'line': {
        const pts = [a.from.x, a.from.y, a.to.x, a.to.y]
        const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>): void => {
          const nx = e.target.x()
          const ny = e.target.y()
          e.target.position({ x: 0, y: 0 })
          patchAnn(a.id, {
            from: { x: a.from.x + nx, y: a.from.y + ny },
            to: { x: a.to.x + nx, y: a.to.y + ny }
          } as Partial<Annotation>)
        }
        return a.kind === 'arrow' ? (
          <Arrow
            key={a.id}
            points={pts}
            stroke={a.color}
            fill={a.color}
            strokeWidth={a.thickness}
            pointerLength={a.thickness * 2.5}
            pointerWidth={a.thickness * 2.5}
            hitStrokeWidth={Math.max(14, a.thickness)}
            {...common}
            onDragEnd={onDragEnd}
          />
        ) : (
          <Line
            key={a.id}
            points={pts}
            stroke={a.color}
            strokeWidth={a.thickness}
            lineCap="round"
            hitStrokeWidth={Math.max(14, a.thickness)}
            {...common}
            onDragEnd={onDragEnd}
          />
        )
      }
      case 'pen':
        return (
          <Line
            key={a.id}
            points={a.points}
            stroke={a.color}
            strokeWidth={a.thickness}
            tension={0.35}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={Math.max(16, a.thickness)}
            {...common}
            onDragEnd={(e) => {
              const nx = e.target.x()
              const ny = e.target.y()
              e.target.position({ x: 0, y: 0 })
              patchAnn(a.id, {
                points: a.points.map((v, i) => (i % 2 === 0 ? v + nx : v + ny))
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
      case 'callout': {
        const pad = a.fontSize * 0.5
        return (
          <Group
            key={a.id}
            ref={setRef(a.id)}
            x={a.rect.x}
            y={a.rect.y}
            {...common}
            onDragEnd={moveRect(a)}
            onTransformEnd={(e) => {
              const node = e.target as Konva.Group
              const w = Math.max(20, a.rect.width * node.scaleX())
              const h = Math.max(20, a.rect.height * node.scaleY())
              node.scaleX(1)
              node.scaleY(1)
              patchAnn(a.id, { rect: { x: node.x(), y: node.y(), width: w, height: h } } as Partial<Annotation>)
            }}
          >
            <Rect
              width={a.rect.width}
              height={a.rect.height}
              fill={hexToRgba(a.fill, 0.92)}
              cornerRadius={a.fontSize * 0.4}
            />
            <KText
              x={pad}
              y={pad}
              width={Math.max(1, a.rect.width - pad * 2)}
              text={a.text}
              fill={a.color}
              fontSize={a.fontSize}
              fontStyle="bold"
              lineHeight={1.25}
              wrap="none"
              listening={false}
            />
          </Group>
        )
      }
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
  const activeKind = selected?.kind ?? tool
  const showThickness = ['border', 'rect', 'ellipse', 'arrow', 'line', 'pen'].includes(activeKind)
  const showFont = activeKind === 'text' || activeKind === 'callout'
  const showFill = activeKind === 'rect' || activeKind === 'ellipse'
  const selFill = selected && 'fill' in selected && selected.kind !== 'callout' ? !!selected.fill : fillOn

  /** Apply a color from the palette to the current tool and the selected shape. */
  const pickColor = (c: string): void => {
    setColor(c)
    if (!selected) return
    if (selected.kind === 'callout') editAnn(selected.id, { fill: c, color: textOn(c) } as Partial<Annotation>)
    else if (selected.kind === 'rect' || selected.kind === 'ellipse')
      editAnn(selected.id, { color: c, ...(selected.fill ? { fill: c } : {}) } as Partial<Annotation>)
    else if ('color' in selected) editAnn(selected.id, { color: c } as Partial<Annotation>)
  }

  const toolTitle = (tl: Tool): string => `${t(`editor.${tl}`)} (${TOOL_KEY[tl].toUpperCase()})`

  return (
    <div className="editor-modal">
      <div className="editor-head">
        <div className="nav-group">
          <button className="btn ghost sm" onClick={onPrev} disabled={index <= 1} title={`${t('editor.prev')} (←)`}>
            ‹
          </button>
          <span className="nav-pos">
            {index} / {total}
          </span>
          <button className="btn ghost sm" onClick={onNext} disabled={index >= total} title={`${t('editor.next')} (→)`}>
            ›
          </button>
        </div>
        <strong>
          {t('gallery.step', { index: item.index })} · {t(`captureMode.${item.captureMode}`)}
        </strong>
        <div className="spacer" />

        <div className="icon-group">
          <button className="ibtn" onClick={undo} disabled={past.current.length === 0} title={`${t('editor.undo')} (Ctrl+Z)`}>
            <Icon name="undo" />
          </button>
          <button className="ibtn" onClick={redo} disabled={future.current.length === 0} title={`${t('editor.redo')} (Ctrl+Y)`}>
            <Icon name="redo" />
          </button>
        </div>
        <div className="icon-group">
          <button className="ibtn" onClick={() => zoomBy(0.8)} title={t('editor.zoomOut')}>
            <Icon name="zoomOut" />
          </button>
          <button className="zoom-val" onClick={() => setZoom(1)} title="100%">
            {Math.round(scale * 100)}%
          </button>
          <button className="ibtn" onClick={() => zoomBy(1.25)} title={t('editor.zoomIn')}>
            <Icon name="zoomIn" />
          </button>
          <button className={`ibtn ${zoom === null ? 'active' : ''}`} onClick={() => setZoom(null)} title={t('editor.zoomFit')}>
            <Icon name="fit" />
          </button>
        </div>
        <div className="icon-group">
          <button className="ibtn" onClick={() => void copyImage()} title={`${t('editor.copyImage')} (Ctrl+C)`}>
            <Icon name="copy" />
          </button>
          <button className="ibtn" onClick={() => void saveImage()} title={`${t('editor.saveImage')} (Ctrl+S)`}>
            <Icon name="save" />
          </button>
        </div>
        {crop && (
          <button
            className="btn ghost sm"
            onClick={() => {
              pushHistory()
              setCrop(null)
              if (selectedId === CROP_ID) setSelectedId(null)
            }}
          >
            ✂ {t('editor.cropClear')}
          </button>
        )}
        <button className="ibtn danger" onClick={removeSelected} disabled={!selectedId} title={`${t('editor.deleteShape')} (Del)`}>
          <Icon name="trash" />
        </button>
        <button className="btn primary sm" onClick={onClose}>
          {t('editor.done')}
        </button>
      </div>

      <div className="editor-tools" title={t('editor.toolsHint')}>
        {TOOL_GROUPS.map((group, gi) => (
          <div className="tool-group" key={gi}>
            {group.map((tl) => (
              <button
                key={tl}
                className={`tool ${tool === tl ? 'active' : ''}`}
                onClick={() => setTool(tl)}
                title={toolTitle(tl)}
                aria-label={t(`editor.${tl}`)}
              >
                <Icon name={tl} />
                <span className="tool-label">{t(`editor.${tl}`)}</span>
              </button>
            ))}
          </div>
        ))}

        <span className="divider" />

        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => pickColor(c)}
              title={c}
            />
          ))}
          <label className="swatch custom" title={t('editor.customColor')} style={{ background: color }}>
            <input type="color" value={color} onChange={(e) => pickColor(e.target.value)} />
          </label>
        </div>

        <span className="divider" />

        {showFill && (
          <label className="ctl chk">
            <input
              type="checkbox"
              checked={selFill}
              onChange={(e) => {
                setFillOn(e.target.checked)
                if (selected && (selected.kind === 'rect' || selected.kind === 'ellipse'))
                  editAnn(selected.id, { fill: e.target.checked ? selected.color : undefined } as Partial<Annotation>)
              }}
            />
            <Icon name="fill" size={15} /> {t('editor.fill')}
          </label>
        )}
        {showThickness && (
          <label className="ctl">
            <span>{t('editor.thickness')}</span>
            <input
              type="range"
              min={1}
              max={20}
              value={selected && 'thickness' in selected ? selected.thickness : thickness}
              onChange={(e) => {
                const v = Number(e.target.value)
                setThickness(v)
                if (selected && 'thickness' in selected) patchAnn(selected.id, { thickness: v } as Partial<Annotation>)
              }}
              onMouseDown={() => selected && pushHistory()}
            />
          </label>
        )}
        {showFont && (
          <label className="ctl">
            <span>{t('editor.fontSize')}</span>
            <input
              type="range"
              min={12}
              max={96}
              value={selected && 'fontSize' in selected ? selected.fontSize : fontSize}
              onChange={(e) => {
                const v = Number(e.target.value)
                setFontSize(v)
                if (selected && 'fontSize' in selected) patchAnn(selected.id, { fontSize: v } as Partial<Annotation>)
              }}
              onMouseDown={() => selected && pushHistory()}
            />
          </label>
        )}
        {selected?.kind === 'blur' && (
          <label className="ctl">
            <span>{t('editor.blur')}</span>
            <input
              type="range"
              min={2}
              max={40}
              value={selected.intensity}
              onChange={(e) => patchAnn(selected.id, { intensity: Number(e.target.value) } as Partial<Annotation>)}
              onMouseDown={pushHistory}
            />
          </label>
        )}
        {selected?.kind === 'mosaic' && (
          <label className="ctl">
            <span>{t('editor.cellSize')}</span>
            <input
              type="range"
              min={4}
              max={60}
              value={selected.size}
              onChange={(e) => patchAnn(selected.id, { size: Number(e.target.value) } as Partial<Annotation>)}
              onMouseDown={pushHistory}
            />
          </label>
        )}
      </div>

      <div className="editor-canvas" ref={wrapRef}>
        {img ? (
          <Stage
            width={imgW * scale}
            height={imgH * scale}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            <Layer scaleX={scale} scaleY={scale}>
              <KImage image={img} width={imgW} height={imgH} name="bg" />
              {annotations.map(renderAnnotation)}
              {crop && (
                <>
                  {/* Dim everything outside the crop; the region itself is movable/resizable. */}
                  <Rect x={0} y={0} width={imgW} height={Math.max(0, crop.y)} fill="rgba(0,0,0,0.45)" listening={false} />
                  <Rect x={0} y={crop.y + crop.height} width={imgW} height={Math.max(0, imgH - crop.y - crop.height)} fill="rgba(0,0,0,0.45)" listening={false} />
                  <Rect x={0} y={crop.y} width={Math.max(0, crop.x)} height={crop.height} fill="rgba(0,0,0,0.45)" listening={false} />
                  <Rect x={crop.x + crop.width} y={crop.y} width={Math.max(0, imgW - crop.x - crop.width)} height={crop.height} fill="rgba(0,0,0,0.45)" listening={false} />
                  <Rect
                    ref={setRef(CROP_ID)}
                    x={crop.x}
                    y={crop.y}
                    width={crop.width}
                    height={crop.height}
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeScaleEnabled={false}
                    dash={[10, 6]}
                    draggable={tool === 'select'}
                    onClick={() => setSelectedId(CROP_ID)}
                    onTap={() => setSelectedId(CROP_ID)}
                    onDragStart={pushHistory}
                    onTransformStart={pushHistory}
                    onDragEnd={(e) => setCrop(clampCrop({ ...crop, x: e.target.x(), y: e.target.y() }))}
                    onTransformEnd={(e) => {
                      const node = e.target as Konva.Rect
                      const w = Math.max(8, node.width() * node.scaleX())
                      const h = Math.max(8, node.height() * node.scaleY())
                      node.scaleX(1)
                      node.scaleY(1)
                      setCrop(clampCrop({ x: node.x(), y: node.y(), width: w, height: h }))
                    }}
                  />
                </>
              )}
              {/* Free-form resize from every anchor; hold Shift to keep the aspect ratio. */}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                ignoreStroke
                keepRatio={false}
                shiftBehavior="inverted"
              />
            </Layer>
          </Stage>
        ) : (
          <div className="loading">…</div>
        )}
        {toast && <div className="editor-toast">{toast}</div>}
      </div>

      <div className="editor-foot">
        {selected && 'text' in selected ? (
          <input
            className="caption-input"
            value={selected.text}
            placeholder={t('editor.textDefault')}
            onFocus={pushHistory}
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
