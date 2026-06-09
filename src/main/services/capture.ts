import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { desktopCapturer, screen, type Display } from 'electron'
import sharp from 'sharp'
import type {
  Annotation,
  CaptureItem,
  CaptureMode,
  CaptureTrigger,
  ElementInfo,
  OutputFormat,
  Point,
  Rect
} from '@shared/types'
import type { SettingsStore } from './settings'
import type { SessionStore } from './session'
import type { ElementQueryResult } from './nativeHelper'
import { clampRect, expandRect, intersectRect, isEmptyRect, scaleRect, translateRect } from './geometry'
import { computeDHash } from './phash'

function formatExt(fmt: OutputFormat): string {
  return fmt === 'jpg' ? 'jpg' : fmt
}

/** Build a capture filename (no extension) from the configured pattern. */
function makeFileBase(pattern: string, ctx: { index: number; seq: number; id: string }): string {
  const d = new Date()
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  // Zero-padded so a name-sort in Explorer equals capture order.
  const timestamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  const out = (pattern || '{timestamp}_{seq}')
    .replace(/\{timestamp\}/g, timestamp)
    .replace(/\{seq\}/g, p(ctx.seq, 4))
    .replace(/\{index\}/g, p(ctx.index, 3))
    .replace(/\{id\}/g, ctx.id.slice(0, 8))
    .replace(/[<>:"/\\|?*]/g, '_') // strip only Windows-illegal chars
    .trim()
  return out || timestamp
}

/** Physical-pixel rect of a display in the global desktop coordinate space. */
export function displayPhysicalRect(display: Display): Rect {
  const s = screen as unknown as { dipToScreenRect?: (w: null, r: Rect) => Rect }
  if (typeof s.dipToScreenRect === 'function') {
    return s.dipToScreenRect(null, display.bounds as unknown as Rect)
  }
  const f = display.scaleFactor || 1
  return {
    x: display.bounds.x * f,
    y: display.bounds.y * f,
    width: display.bounds.width * f,
    height: display.bounds.height * f
  }
}

function buildCaption(
  lang: string,
  el: ElementInfo | undefined,
  trigger: CaptureTrigger
): string | undefined {
  const name = el?.name?.trim()
  const isInput = trigger === 'text-commit'
  if (lang === 'ko') {
    if (isInput) return name ? `'${name}' 입력` : '입력'
    return name ? `'${name}' 클릭` : '클릭'
  }
  if (isInput) return name ? `Enter "${name}"` : 'Enter text'
  return name ? `Click "${name}"` : 'Click'
}

export class CaptureService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly session: SessionStore
  ) {}

  /**
   * Grab a screenshot at `physPoint`, applying the configured capture mode using
   * the UIA element/window geometry. Saves a CLEAN raw image (non-destructive)
   * plus a `border` annotation; the gallery thumbnail shows the composited border.
   */
  async capture(
    physPoint: Point,
    dipPoint: Point,
    trigger: CaptureTrigger,
    query: ElementQueryResult | null,
    pregrab?: { buffer: Buffer; dp: Rect }
  ): Promise<CaptureItem | null> {
    const s = this.settings.get()
    const display = screen.getDisplayNearestPoint(dipPoint)

    let baseBuffer: Buffer
    let capW: number
    let capH: number
    let dp: Rect
    if (pregrab) {
      // Frame already frozen by the sidecar at trigger time (pre-navigation).
      baseBuffer = pregrab.buffer
      dp = pregrab.dp
      capW = dp.width
      capH = dp.height
    } else {
      const scaleFactor = display.scaleFactor || 1
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.bounds.width * scaleFactor),
          height: Math.round(display.bounds.height * scaleFactor)
        }
      })
      if (sources.length === 0) return null
      const source = sources.find((src) => src.display_id === String(display.id)) ?? sources[0]
      const baseImage = source.thumbnail
      const size = baseImage.getSize()
      capW = size.width
      capH = size.height
      baseBuffer = baseImage.toPNG()
      dp = displayPhysicalRect(display)
    }
    const baseBounds: Rect = { x: 0, y: 0, width: capW, height: capH }

    // Map global physical-px rects into base-image px.
    const sx = dp.width > 0 ? capW / dp.width : 1
    const sy = dp.height > 0 ? capH / dp.height : 1
    const toBase = (r: Rect): Rect => ({
      x: (r.x - dp.x) * sx,
      y: (r.y - dp.y) * sy,
      width: r.width * sx,
      height: r.height * sy
    })

    const elBaseRaw = query?.element
      ? clampRect(toBase(query.element.bounds), baseBounds)
      : null
    const winBase = query?.window ? clampRect(toBase(query.window.bounds), baseBounds) : null
    const ptBase = toBase({ x: physPoint.x, y: physPoint.y, width: 0, height: 0 })

    // Sanity: a correct ElementFromPoint result contains the click point. If it
    // doesn't (e.g. the page navigated before the element was resolved), ignore the
    // element so we never draw a misplaced border / wrong-sized box.
    const containsClick =
      !!elBaseRaw &&
      ptBase.x >= elBaseRaw.x - 2 &&
      ptBase.x <= elBaseRaw.x + elBaseRaw.width + 2 &&
      ptBase.y >= elBaseRaw.y - 2 &&
      ptBase.y <= elBaseRaw.y + elBaseRaw.height + 2
    const el = containsClick ? elBaseRaw : null
    const elementValid = !!el

    // Resolve crop region + effective mode (graceful degradation).
    let mode: CaptureMode = s.capture.mode
    let crop: Rect = baseBounds
    if (mode === 'element') {
      if (el && !isEmptyRect(el)) {
        crop = clampRect(expandRect(el, s.capture.elementPadding), baseBounds)
      } else if (winBase && !isEmptyRect(winBase)) {
        crop = winBase
        mode = 'window'
      } else {
        mode = 'fullscreen'
      }
    } else if (mode === 'window') {
      if (winBase && !isEmptyRect(winBase)) crop = winBase
      else mode = 'fullscreen'
    } else if (mode === 'cursor') {
      const size = s.capture.cursorAreaSize
      crop = clampRect(
        { x: ptBase.x - size / 2, y: ptBase.y - size / 2, width: size, height: size },
        baseBounds
      )
    }

    // Element border rect relative to the crop region.
    let borderInCrop: Rect | null = null
    if (el && !isEmptyRect(el)) {
      const inter = intersectRect(el, crop)
      if (!isEmptyRect(inter)) borderInCrop = translateRect(inter, -crop.x, -crop.y)
    }

    // Crop the clean base image.
    const needCrop = !(crop.x === 0 && crop.y === 0 && crop.width === capW && crop.height === capH)
    let cropBuf = baseBuffer
    const cropW = Math.round(crop.width)
    const cropH = Math.round(crop.height)
    if (needCrop && cropW > 0 && cropH > 0) {
      cropBuf = await sharp(baseBuffer)
        .extract({
          left: Math.round(crop.x),
          top: Math.round(crop.y),
          width: cropW,
          height: cropH
        })
        .png()
        .toBuffer()
    }

    // Encode at the configured scale/format (raw stays CLEAN — no border baked in).
    const { buffer: finalBuf, width: finalW, height: finalH } = await this.encode(
      cropBuf,
      cropW || capW,
      s.capture
    )
    const finalScale = (cropW || capW) > 0 ? finalW / (cropW || capW) : 1
    const borderFinal = borderInCrop ? scaleRect(borderInCrop, finalScale, finalScale) : null

    const id = randomUUID()
    const index = s.features.autoNumber ? this.session.nextIndex() : 0
    const ext = formatExt(s.capture.format)
    // File name is time/seq-ordered so Explorer's name-sort matches capture order.
    const base = makeFileBase(s.storage.fileNamePattern, {
      index,
      seq: this.session.nextSeq(),
      id
    })
    await fs.mkdir(this.session.getRawDir(), { recursive: true })
    let rawPath = this.session.rawPathFor(base, ext)
    if (existsSync(rawPath)) rawPath = this.session.rawPathFor(`${base}_${id.slice(0, 8)}`, ext)
    await fs.writeFile(rawPath, finalBuf)

    const annotations: Annotation[] = []
    if (borderFinal && !isEmptyRect(borderFinal)) {
      annotations.push({
        id: randomUUID(),
        kind: 'border',
        rect: borderFinal,
        color: s.border.color,
        thickness: s.border.thickness,
        radius: s.border.radius
      })
    }

    const element: ElementInfo | undefined =
      query?.element && elementValid
        ? {
            bounds: borderFinal ?? { x: 0, y: 0, width: 0, height: 0 },
            controlType: query.element.controlType,
            name: query.element.name || undefined,
            isEditable: query.element.editable
          }
        : undefined

    const caption = s.features.autoCaption ? buildCaption(s.language, element, trigger) : undefined

    const thumbnailDataUrl = await this.makeThumbnail(
      finalBuf,
      finalW,
      finalH,
      borderFinal,
      s.border
    )

    let pHash: string | undefined
    if (s.features.duplicateDetection) {
      try {
        pHash = await computeDHash(finalBuf)
      } catch {
        /* non-fatal */
      }
    }

    const item: CaptureItem = {
      id,
      index,
      rawImagePath: rawPath,
      width: finalW,
      height: finalH,
      thumbnailDataUrl,
      capturedAt: Date.now(),
      trigger,
      captureMode: mode,
      displayId: display.id,
      clickPoint: dipPoint,
      element,
      caption,
      annotations,
      pHash
    }
    this.session.add(item)
    return item
  }

  private async encode(
    input: Buffer,
    srcWidth: number,
    cap: ReturnType<SettingsStore['get']>['capture']
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    let pipeline = sharp(input)
    const constraints: { width?: number; height?: number } = {}
    if (cap.scale && cap.scale > 0 && cap.scale !== 1) {
      constraints.width = Math.max(1, Math.round(srcWidth * cap.scale))
    }
    if (cap.maxWidth > 0) constraints.width = Math.min(constraints.width ?? srcWidth, cap.maxWidth)
    if (cap.maxHeight > 0) constraints.height = cap.maxHeight
    if (constraints.width || constraints.height) {
      pipeline = pipeline.resize({ ...constraints, fit: 'inside', withoutEnlargement: true })
    }

    switch (cap.format) {
      case 'jpg':
        pipeline = pipeline.jpeg({ quality: cap.quality })
        break
      case 'webp':
        pipeline = pipeline.webp({ quality: cap.quality })
        break
      default:
        pipeline = pipeline.png()
    }
    const out = await pipeline.toBuffer({ resolveWithObject: true })
    return { buffer: out.data, width: out.info.width, height: out.info.height }
  }

  private borderSvg(w: number, h: number, rect: Rect, color: string, thickness: number, radius: number): Buffer {
    const inset = thickness / 2
    const x = rect.x + inset
    const y = rect.y + inset
    const rw = Math.max(0, rect.width - thickness)
    const rh = Math.max(0, rect.height - thickness)
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${radius}" ` +
      `fill="none" stroke="${color}" stroke-width="${thickness}"/></svg>`
    return Buffer.from(svg)
  }

  private async makeThumbnail(
    input: Buffer,
    width: number,
    height: number,
    border: Rect | null,
    borderStyle: ReturnType<SettingsStore['get']>['border']
  ): Promise<string> {
    const tw = Math.min(400, width)
    const ts = width > 0 ? tw / width : 1
    const th = Math.round(height * ts)
    let pipeline = sharp(input).resize({ width: tw, withoutEnlargement: true })
    if (border && !isEmptyRect(border)) {
      const scaled = scaleRect(border, ts, ts)
      const svg = this.borderSvg(
        tw,
        th,
        scaled,
        borderStyle.color,
        Math.max(1, borderStyle.thickness * ts),
        borderStyle.radius * ts
      )
      pipeline = pipeline.composite([{ input: svg, top: 0, left: 0 }])
    }
    const data = await pipeline.jpeg({ quality: 72 }).toBuffer()
    return `data:image/jpeg;base64,${data.toString('base64')}`
  }
}
