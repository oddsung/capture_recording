import { promises as fs } from 'node:fs'
import sharp from 'sharp'
import type { Annotation, CaptureItem } from '@shared/types'
import { ARROW_HEAD, PEN_TENSION } from '@shared/annotationStyle'
import { clampRect, isEmptyRect, roundRect } from './geometry'

const FONT = 'Malgun Gothic, Arial, sans-serif'

/**
 * SVG path for a freehand stroke, smoothed exactly like Konva's open `Line`
 * with `tension` (Catmull-Rom-style control points), so the export matches
 * what the editor shows.
 */
function penPath(p: number[]): string {
  const len = p.length
  if (len < 4) return ''
  const f = (v: number): string => String(Math.round(v * 100) / 100)
  const straight = `M${f(p[0])},${f(p[1])} L${f(p[len - 2])},${f(p[len - 1])}`
  if (len === 4) return straight
  // Per interior point: [cp1x, cp1y, px, py, cp2x, cp2y]
  const tp: number[] = []
  for (let n = 2; n < len - 2; n += 2) {
    const x0 = p[n - 2], y0 = p[n - 1], x1 = p[n], y1 = p[n + 1], x2 = p[n + 2], y2 = p[n + 3]
    const d01 = Math.hypot(x1 - x0, y1 - y0)
    const d12 = Math.hypot(x2 - x1, y2 - y1)
    if (d01 + d12 === 0) continue // duplicate points (Konva skips NaN control points)
    const fa = (PEN_TENSION * d01) / (d01 + d12)
    const fb = (PEN_TENSION * d12) / (d01 + d12)
    tp.push(x1 - fa * (x2 - x0), y1 - fa * (y2 - y0), x1, y1, x1 + fb * (x2 - x0), y1 + fb * (y2 - y0))
  }
  if (tp.length === 0) return straight
  let d = `M${f(p[0])},${f(p[1])} Q${f(tp[0])},${f(tp[1])} ${f(tp[2])},${f(tp[3])}`
  for (let n = 4; n < tp.length - 2; n += 6) {
    d += ` C${f(tp[n])},${f(tp[n + 1])} ${f(tp[n + 2])},${f(tp[n + 3])} ${f(tp[n + 4])},${f(tp[n + 5])}`
  }
  d += ` Q${f(tp[tp.length - 2])},${f(tp[tp.length - 1])} ${f(p[len - 2])},${f(p[len - 1])}`
  return d
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Build an SVG overlay for all non-blur annotations (image-pixel coordinates). */
function buildVectorSvg(annotations: Annotation[], w: number, h: number): string {
  const parts: string[] = []
  for (const a of annotations) {
    switch (a.kind) {
      case 'border':
      case 'rect': {
        const inset = a.thickness / 2
        const fill = a.kind === 'rect' && a.fill ? `fill="${a.fill}" fill-opacity="0.3"` : 'fill="none"'
        parts.push(
          `<rect x="${a.rect.x + inset}" y="${a.rect.y + inset}" ` +
            `width="${Math.max(0, a.rect.width - a.thickness)}" height="${Math.max(0, a.rect.height - a.thickness)}" ` +
            `rx="${a.kind === 'border' ? a.radius : 0}" ${fill} stroke="${a.color}" stroke-width="${a.thickness}"/>`
        )
        break
      }
      case 'ellipse': {
        const inset = a.thickness / 2
        const rx = Math.max(0, a.rect.width / 2 - inset)
        const ry = Math.max(0, a.rect.height / 2 - inset)
        const fill = a.fill ? `fill="${a.fill}" fill-opacity="0.3"` : 'fill="none"'
        parts.push(
          `<ellipse cx="${a.rect.x + a.rect.width / 2}" cy="${a.rect.y + a.rect.height / 2}" rx="${rx}" ry="${ry}" ` +
            `${fill} stroke="${a.color}" stroke-width="${a.thickness}"/>`
        )
        break
      }
      case 'line':
        parts.push(
          `<line x1="${a.from.x}" y1="${a.from.y}" x2="${a.to.x}" y2="${a.to.y}" ` +
            `stroke="${a.color}" stroke-width="${a.thickness}" stroke-linecap="round"/>`
        )
        break
      case 'pen': {
        const d = penPath(a.points)
        if (d) {
          parts.push(
            `<path d="${d}" fill="none" stroke="${a.color}" ` +
              `stroke-width="${a.thickness}" stroke-linecap="round" stroke-linejoin="round"/>`
          )
        }
        break
      }
      case 'callout': {
        const pad = a.fontSize * 0.5
        const lineH = a.fontSize * 1.25
        parts.push(
          `<rect x="${a.rect.x}" y="${a.rect.y}" width="${a.rect.width}" height="${a.rect.height}" rx="${a.fontSize * 0.4}" ` +
            `fill="${a.fill}" fill-opacity="0.92"/>`
        )
        const lines = a.text.split('\n')
        lines.forEach((ln, i) => {
          parts.push(
            `<text x="${a.rect.x + pad}" y="${a.rect.y + pad + a.fontSize * 0.85 + i * lineH}" font-family="${FONT}" ` +
              `font-size="${a.fontSize}" font-weight="bold" fill="${a.color}">${escapeXml(ln)}</text>`
          )
        })
        break
      }
      case 'highlight':
        parts.push(
          `<rect x="${a.rect.x}" y="${a.rect.y}" width="${a.rect.width}" height="${a.rect.height}" ` +
            `fill="${a.color}" fill-opacity="${a.opacity}"/>`
        )
        break
      case 'arrow': {
        // Mirrors the editor's Konva Arrow: shaft runs to the tip; the head is a
        // filled AND stroked triangle (pointerLength = pointerWidth = ARROW_HEAD × thickness).
        const { from, to, color, thickness } = a
        const ang = Math.atan2(to.y - from.y, to.x - from.x)
        const hl = thickness * ARROW_HEAD
        const hw = (thickness * ARROW_HEAD) / 2
        const bx = to.x - hl * Math.cos(ang)
        const by = to.y - hl * Math.sin(ang)
        const p1x = bx + hw * Math.sin(ang)
        const p1y = by - hw * Math.cos(ang)
        const p2x = bx - hw * Math.sin(ang)
        const p2y = by + hw * Math.cos(ang)
        parts.push(
          `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"/>`
        )
        parts.push(
          `<polygon points="${to.x},${to.y} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}" ` +
            `stroke="${color}" stroke-width="${thickness}" stroke-linejoin="miter"/>`
        )
        break
      }
      case 'text':
        parts.push(
          `<text x="${a.at.x}" y="${a.at.y + a.fontSize * 0.82}" font-family="${FONT}" ` +
            `font-size="${a.fontSize}" font-weight="bold" fill="${a.color}">${escapeXml(a.text)}</text>`
        )
        break
      case 'badge':
        parts.push(`<circle cx="${a.at.x}" cy="${a.at.y}" r="18" fill="${a.color}"/>`)
        parts.push(
          `<text x="${a.at.x}" y="${a.at.y + 7}" font-family="${FONT}" font-size="20" font-weight="bold" ` +
            `fill="#ffffff" text-anchor="middle">${escapeXml(a.label)}</text>`
        )
        break
      default:
        break
    }
  }
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

/** Raw image + annotations baked in (real blur + vector overlay). PNG buffer. */
export async function flattenItem(item: CaptureItem): Promise<{
  buffer: Buffer
  width: number
  height: number
}> {
  const raw = await fs.readFile(item.rawImagePath)
  const meta = await sharp(raw).metadata()
  const w = item.width || meta.width || 0
  const h = item.height || meta.height || 0
  const bounds = { x: 0, y: 0, width: w, height: h }

  const composites: sharp.OverlayOptions[] = []
  for (const a of item.annotations) {
    if (a.kind !== 'blur' && a.kind !== 'mosaic') continue
    const r = roundRect(clampRect(a.rect, bounds))
    if (isEmptyRect(r)) continue
    const extract = { left: r.x, top: r.y, width: r.width, height: r.height }
    let region: Buffer
    if (a.kind === 'blur') {
      const sigma = Math.min(1000, Math.max(0.3, a.intensity || 8))
      region = await sharp(raw).extract(extract).blur(sigma).png().toBuffer()
    } else {
      // Pixelate: shrink to one pixel per cell, then scale back up without smoothing.
      const cell = Math.max(2, Math.round(a.size || 12))
      const sw = Math.max(1, Math.round(r.width / cell))
      const sh = Math.max(1, Math.round(r.height / cell))
      const small = await sharp(raw)
        .extract(extract)
        .resize(sw, sh, { kernel: 'nearest', fit: 'fill' })
        .png()
        .toBuffer()
      region = await sharp(small)
        .resize(r.width, r.height, { kernel: 'nearest', fit: 'fill' })
        .png()
        .toBuffer()
    }
    composites.push({ input: region, left: r.x, top: r.y })
  }

  composites.push({ input: Buffer.from(buildVectorSvg(item.annotations, w, h)), top: 0, left: 0 })
  let buffer = await sharp(raw).composite(composites).png().toBuffer()

  // Non-destructive crop: annotations live in full-image coordinates, so the
  // crop is applied AFTER they are baked in. The raw file is never touched.
  if (item.crop) {
    const c = roundRect(clampRect(item.crop, bounds))
    if (!isEmptyRect(c) && (c.width < w || c.height < h)) {
      buffer = await sharp(buffer)
        .extract({ left: c.x, top: c.y, width: c.width, height: c.height })
        .png()
        .toBuffer()
      return { buffer, width: c.width, height: c.height }
    }
  }
  return { buffer, width: w, height: h }
}

/** Add a bottom caption/number banner (used for image & PDF export). */
export async function composeStepImage(
  flatBuf: Buffer,
  w: number,
  h: number,
  opts: { index: number; caption?: string; numbering: boolean; captions: boolean }
): Promise<Buffer> {
  const label = [
    opts.numbering && opts.index ? `${opts.index}.` : '',
    opts.captions ? opts.caption ?? '' : ''
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!label) return flatBuf

  const bannerH = Math.max(44, Math.round(w * 0.028))
  const fontSize = Math.round(bannerH * 0.52)
  const svg =
    `<svg width="${w}" height="${h + bannerH}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="${h}" width="${w}" height="${bannerH}" fill="#1c1d21"/>` +
    `<text x="${Math.round(bannerH * 0.4)}" y="${h + Math.round(bannerH * 0.66)}" ` +
    `font-family="${FONT}" font-size="${fontSize}" fill="#ffffff">${escapeXml(label)}</text></svg>`

  return sharp({
    create: { width: w, height: h + bannerH, channels: 4, background: { r: 28, g: 29, b: 33, alpha: 1 } }
  })
    .composite([
      { input: flatBuf, top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 }
    ])
    .png()
    .toBuffer()
}
