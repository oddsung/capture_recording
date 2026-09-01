import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from 'docx'
import pptxgen from 'pptxgenjs'
import type { CaptureItem, ExportOptions, ExportResult } from '@shared/types'
import { PRODUCT_NAME } from '@shared/product'
import { flattenItem, composeStepImage } from './flatten'

interface Flat {
  item: CaptureItem
  buffer: Buffer
  width: number
  height: number
}

const pad = (n: number): string => String(n).padStart(2, '0')

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stepLabel(item: CaptureItem, i: number, numbering: boolean, captions: boolean): string {
  const num = numbering ? `${item.index || i + 1}.` : ''
  const cap = captions ? item.caption ?? '' : ''
  return [num, cap].filter(Boolean).join(' ').trim() || `Step ${i + 1}`
}

/** Watermark composited onto free-plan exports (Pro removes it). */
export async function applyWatermark(flat: {
  buffer: Buffer
  width: number
  height: number
}): Promise<{ buffer: Buffer; width: number; height: number }> {
  const text = `Made with ${PRODUCT_NAME}`
  const fontSize = Math.max(13, Math.round(flat.width * 0.014))
  const padX = Math.round(fontSize * 0.9)
  const pillW = Math.round(text.length * fontSize * 0.52) + padX * 2
  const pillH = Math.round(fontSize * 2)
  const margin = Math.round(fontSize * 0.9)
  const x = Math.max(0, flat.width - pillW - margin)
  const y = Math.max(0, flat.height - pillH - margin)
  const svg =
    `<svg width="${flat.width}" height="${flat.height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${x}" y="${y}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#000" fill-opacity="0.45"/>` +
    `<text x="${x + pillW / 2}" y="${y + pillH / 2 + fontSize * 0.35}" text-anchor="middle" ` +
    `font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" fill="#fff" fill-opacity="0.95">${text}</text>` +
    `</svg>`
  const buffer = await sharp(flat.buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
  return { buffer, width: flat.width, height: flat.height }
}

export async function exportSession(
  items: CaptureItem[],
  opts: ExportOptions,
  branding?: { watermark: boolean }
): Promise<ExportResult> {
  const files: string[] = []
  try {
    const visible = items.filter((i) => i.flagged !== 'deleted')
    if (visible.length === 0) {
      return { ok: false, outDir: opts.outDir, files, count: 0, error: 'no captures' }
    }
    await fs.mkdir(opts.outDir, { recursive: true })

    const flats: Flat[] = []
    for (const item of visible) {
      // Watermark is applied to the flattened image, so every downstream
      // format (images, PDF, HTML assets, DOCX, PPTX) inherits it.
      let flat = await flattenItem(item)
      if (branding?.watermark) flat = await applyWatermark(flat)
      flats.push({ item, ...flat })
    }

    const wantImages = opts.formats.includes('png') || opts.formats.includes('jpg')
    const imgFmt = opts.formats.includes('jpg') ? 'jpg' : 'png'
    const needComposed = wantImages || opts.formats.includes('pdf')

    const composed: Buffer[] = []
    if (needComposed) {
      for (const f of flats) {
        composed.push(
          await composeStepImage(f.buffer, f.width, f.height, {
            index: f.item.index,
            caption: f.item.caption,
            numbering: opts.numbering,
            captions: opts.captions
          })
        )
      }
    }

    // Shared flat images for HTML / Markdown.
    let assetNames: string[] = []
    if (opts.formats.includes('html') || opts.formats.includes('md')) {
      const dir = join(opts.outDir, 'images')
      await fs.mkdir(dir, { recursive: true })
      assetNames = []
      for (let i = 0; i < flats.length; i++) {
        const name = `step-${pad(i + 1)}.png`
        await fs.writeFile(join(dir, name), flats[i].buffer)
        assetNames.push(`images/${name}`)
      }
    }

    if (wantImages) {
      const dir = join(opts.outDir, 'steps')
      await fs.mkdir(dir, { recursive: true })
      for (let i = 0; i < composed.length; i++) {
        const out =
          imgFmt === 'jpg' ? await sharp(composed[i]).jpeg({ quality: 90 }).toBuffer() : composed[i]
        const p = join(dir, `step-${pad(i + 1)}.${imgFmt}`)
        await fs.writeFile(p, out)
        files.push(p)
      }
    }
    if (opts.formats.includes('pdf')) {
      const p = join(opts.outDir, 'guide.pdf')
      await exportPdf(composed, p)
      files.push(p)
    }
    if (opts.formats.includes('html')) {
      const p = join(opts.outDir, 'guide.html')
      await fs.writeFile(p, buildHtml(flats, assetNames, opts))
      files.push(p)
    }
    if (opts.formats.includes('md')) {
      const p = join(opts.outDir, 'guide.md')
      await fs.writeFile(p, buildMarkdown(flats, assetNames, opts))
      files.push(p)
    }
    if (opts.formats.includes('docx')) {
      const p = join(opts.outDir, 'guide.docx')
      await exportDocx(flats, opts, p)
      files.push(p)
    }
    if (opts.formats.includes('pptx')) {
      const p = join(opts.outDir, 'guide.pptx')
      await exportPptx(flats, opts, p)
      files.push(p)
    }

    return { ok: true, outDir: opts.outDir, files, count: visible.length }
  } catch (err) {
    return {
      ok: false,
      outDir: opts.outDir,
      files,
      count: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function exportPdf(pages: Buffer[], outFile: string): Promise<void> {
  const pdf = await PDFDocument.create()
  for (const png of pages) {
    const img = await pdf.embedPng(png)
    const page = pdf.addPage([img.width, img.height])
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  await fs.writeFile(outFile, await pdf.save())
}

function buildHtml(flats: Flat[], assets: string[], opts: ExportOptions): string {
  const sections = flats
    .map((f, i) => {
      const label = stepLabel(f.item, i, opts.numbering, opts.captions)
      return `<section><h2>${escapeHtml(label)}</h2><img src="${assets[i]}" alt="${escapeHtml(label)}"/></section>`
    })
    .join('\n')
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Capture Guide</title>` +
    `<style>body{font-family:'Malgun Gothic',system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1c1d21}` +
    `h1{font-size:24px}h2{margin-top:28px;font-size:18px}img{max-width:100%;border:1px solid #ddd;border-radius:8px}</style>` +
    `</head><body><h1>Capture Guide</h1>${sections}</body></html>`
  )
}

function buildMarkdown(flats: Flat[], assets: string[], opts: ExportOptions): string {
  let md = `# Capture Guide\n\n`
  flats.forEach((f, i) => {
    md += `## ${stepLabel(f.item, i, opts.numbering, opts.captions)}\n\n![step ${i + 1}](${assets[i]})\n\n`
  })
  return md
}

async function exportDocx(flats: Flat[], opts: ExportOptions, outFile: string): Promise<void> {
  const children: Paragraph[] = []
  for (let i = 0; i < flats.length; i++) {
    const f = flats[i]
    const scale = Math.min(1, 600 / f.width)
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(stepLabel(f.item, i, opts.numbering, opts.captions))]
      })
    )
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: f.buffer,
            transformation: { width: Math.round(f.width * scale), height: Math.round(f.height * scale) }
          })
        ]
      })
    )
  }
  const doc = new Document({ sections: [{ children }] })
  await fs.writeFile(outFile, await Packer.toBuffer(doc))
}

async function exportPptx(flats: Flat[], opts: ExportOptions, outFile: string): Promise<void> {
  const pptx = new pptxgen()
  for (let i = 0; i < flats.length; i++) {
    const f = flats[i]
    const slide = pptx.addSlide()
    const ar = f.width / Math.max(1, f.height)
    let w = 9.2
    let h = w / ar
    if (h > 4.4) {
      h = 4.4
      w = h * ar
    }
    slide.addImage({
      data: `data:image/png;base64,${f.buffer.toString('base64')}`,
      x: (10 - w) / 2,
      y: 0.3,
      w,
      h
    })
    slide.addText(stepLabel(f.item, i, opts.numbering, opts.captions), {
      x: 0.4,
      y: 0.3 + h + 0.15,
      w: 9.2,
      h: 0.7,
      fontSize: 16,
      color: '363636'
    })
  }
  await pptx.writeFile({ fileName: outFile })
}
