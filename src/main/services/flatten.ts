import { promises as fs } from 'node:fs'
import sharp from 'sharp'
import type { Annotation, CaptureItem } from '@shared/types'
import { clampRect, isEmptyRect, roundRect } from './geometry'

const FONT = 'Malgun Gothic, Arial, sans-serif'

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
        parts.push(
          `<rect x="${a.rect.x + inset}" y="${a.rect.y + inset}" ` +
            `width="${Math.max(0, a.rect.width - a.thickness)}" height="${Math.max(0, a.rect.height - a.thickness)}" ` +
            `rx="${a.kind === 'border' ? a.radius : 0}" fill="none" stroke="${a.color}" stroke-width="${a.thickness}"/>`
        )
        break
      }
      case 'highlight':
        parts.push(
          `<rect x="${a.rect.x}" y="${a.rect.y}" width="${a.rect.width}" height="${a.rect.height}" ` +
            `fill="${a.color}" fill-opacity="${a.opacity}"/>`
        )
        break
      case 'arrow': {
        const { from, to, color, thickness } = a
        const ang = Math.atan2(to.y - from.y, to.x - from.x)
        const hl = thickness * 3
        const hw = thickness * 2.2
        const bx = to.x - hl * Math.cos(ang)
        const by = to.y - hl * Math.sin(ang)
        const p1x = bx + hw * Math.sin(ang)
        const p1y = by - hw * Math.cos(ang)
        const p2x = bx - hw * Math.sin(ang)
        const p2y = by + hw * Math.cos(ang)
        parts.push(
          `<line x1="${from.x}" y1="${from.y}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"/>`
        )
        parts.push(`<polygon points="${to.x},${to.y} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}"/>`)
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
    if (a.kind !== 'blur') continue
    const r = roundRect(clampRect(a.rect, bounds))
    if (isEmptyRect(r)) continue
    const sigma = Math.min(1000, Math.max(0.3, a.intensity || 8))
    const region = await sharp(raw)
      .extract({ left: r.x, top: r.y, width: r.width, height: r.height })
      .blur(sigma)
      .png()
      .toBuffer()
    composites.push({ input: region, left: r.x, top: r.y })
  }

  composites.push({ input: Buffer.from(buildVectorSvg(item.annotations, w, h)), top: 0, left: 0 })
  const buffer = await sharp(raw).composite(composites).png().toBuffer()
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
