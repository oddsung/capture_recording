/**
 * Recording-area picker — one transparent, always-on-top window per display.
 * Drag to select a rectangle, click a highlighted window to snap to its bounds,
 * Enter = whole screen, Esc / right-click = cancel. Pure DOM (no React) so the
 * marquee follows the cursor with minimal latency.
 *
 * All geometry here is CSS px = DIP relative to this display (the window covers
 * exactly one display); main converts the result to global/physical coordinates.
 */
import type { PickerInfo, Rect, RegionPick } from '@shared/types'
import i18n from './i18n'

const displayId = Number(new URLSearchParams(location.search).get('display') ?? 0)

const root = document.getElementById('picker-root') as HTMLDivElement
const canvas = document.createElement('canvas')
const label = document.createElement('div')
label.className = 'label'
label.style.display = 'none'
const hint = document.createElement('div')
hint.className = 'hint'
root.append(canvas, label, hint)
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

/** Snap targets in z-order (front to back), display-relative. */
let windows: Rect[] = []
let titles: string[] = []
let hover = -1
let press: { x: number; y: number } | null = null
let drag: Rect | null = null
let finished = false

const DRAG_THRESHOLD = 4
const MIN_SIZE = 8

function finish(result: RegionPick): void {
  if (finished) return
  finished = true
  window.picker.done(result)
}

function clampToDisplay(r: Rect): Rect {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(innerWidth, r.x + r.width)
  const y1 = Math.min(innerHeight, r.y + r.height)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

function hitTest(x: number, y: number): number {
  return windows.findIndex((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
}

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(innerWidth * dpr)
  canvas.height = Math.round(innerHeight * dpr)
  canvas.style.width = `${innerWidth}px`
  canvas.style.height = `${innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw()
}

function draw(): void {
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  ctx.fillRect(0, 0, innerWidth, innerHeight)

  const sel = drag ?? (hover >= 0 ? windows[hover] : null)
  if (!sel || sel.width <= 0 || sel.height <= 0) {
    label.style.display = 'none'
    return
  }
  // Cut the selection out of the dim layer and outline it.
  const r = clampToDisplay(sel)
  ctx.clearRect(r.x, r.y, r.width, r.height)
  ctx.lineWidth = 2
  ctx.strokeStyle = drag ? '#0a84ff' : '#34c759'
  ctx.setLineDash(drag ? [] : [8, 5])
  ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.width - 2), Math.max(0, r.height - 2))
  ctx.setLineDash([])

  const size = `${Math.round(r.width)} × ${Math.round(r.height)}`
  label.textContent = drag ? size : `${titles[hover]} — ${size}`
  label.style.display = 'block'
  const above = r.y >= 34
  label.style.left = `${Math.max(4, Math.min(r.x, innerWidth - label.offsetWidth - 4))}px`
  label.style.top = `${above ? r.y - 30 : Math.min(innerHeight - 30, r.y + r.height + 6)}px`
}

window.addEventListener('mousemove', (e) => {
  if (press) {
    const moved = Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y)
    if (drag || moved >= DRAG_THRESHOLD) drag = normalize(press, { x: e.clientX, y: e.clientY })
  } else {
    hover = hitTest(e.clientX, e.clientY)
  }
  draw()
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  press = { x: e.clientX, y: e.clientY }
  drag = null
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !press) return
  press = null
  if (drag) {
    const r = clampToDisplay(drag)
    drag = null
    if (r.width >= MIN_SIZE && r.height >= MIN_SIZE) finish({ kind: 'rect', displayId, rect: r })
    else draw()
    return
  }
  // Plain click: snap to the window under the cursor (if any).
  const i = hitTest(e.clientX, e.clientY)
  if (i >= 0) finish({ kind: 'rect', displayId, rect: clampToDisplay(windows[i]) })
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  finish({ kind: 'cancel' })
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish({ kind: 'cancel' })
  else if (e.key === 'Enter') finish({ kind: 'fullscreen' })
})

window.addEventListener('resize', resize)
resize()

void window.picker.getInfo(displayId).then((info: PickerInfo) => {
  void i18n.changeLanguage(info.language).then(() => {
    hint.textContent = i18n.t('picker.hint')
  })
  const d = info.display
  windows = []
  titles = []
  for (const w of info.windows) {
    const r = { x: w.rect.x - d.x, y: w.rect.y - d.y, width: w.rect.width, height: w.rect.height }
    // Only windows that actually intersect this display are snap targets here.
    if (r.x + r.width <= 0 || r.y + r.height <= 0 || r.x >= d.width || r.y >= d.height) continue
    windows.push(r)
    titles.push(w.title || w.process)
  }
  draw()
})
