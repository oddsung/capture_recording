import type { Rect } from '@shared/types'

export function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

/** Clamp r to lie within bounds (returns the intersection). */
export function clampRect(r: Rect, bounds: Rect): Rect {
  const i = intersectRect(r, bounds)
  return isEmptyRect(i) ? { x: bounds.x, y: bounds.y, width: 0, height: 0 } : i
}

export function expandRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }
}

export function scaleRect(r: Rect, sx: number, sy: number): Rect {
  return { x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy }
}

export function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height)
  }
}
