import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, ExportFormat, ExportResult } from '@shared/types'

interface Props {
  settings: AppSettings
  count: number
  onClose: () => void
}

const ALL_FORMATS: ExportFormat[] = ['png', 'jpg', 'pdf', 'html', 'md', 'docx', 'pptx']
/** Formats available on the free plan; the rest are Pro-only. */
const FREE_FORMATS: ExportFormat[] = ['png', 'jpg']

function defaultFormats(s: AppSettings): ExportFormat[] {
  const f: ExportFormat[] = []
  if (s.exportFormats.images) f.push('png')
  if (s.exportFormats.pdf) f.push('pdf')
  if (s.exportFormats.htmlMarkdown) f.push('html', 'md')
  if (s.exportFormats.office) f.push('docx', 'pptx')
  return f.length ? f : ['png']
}

export function ExportModal({ settings, count, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  const [formats, setFormats] = useState<Set<ExportFormat>>(new Set(defaultFormats(settings)))
  const [pro, setPro] = useState(true) // optimistic; resolved on mount
  const [numbering, setNumbering] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [outDir, setOutDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)

  useEffect(() => {
    void window.api.getLicense().then((lic) => {
      const isPro = lic.plan === 'pro'
      setPro(isPro)
      if (!isPro) {
        // Drop Pro-only formats from the preselection.
        setFormats((prev) => {
          const next = new Set([...prev].filter((f) => FREE_FORMATS.includes(f)))
          return next.size ? next : new Set<ExportFormat>(['png'])
        })
      }
    })
  }, [])

  const locked = (f: ExportFormat): boolean => !pro && !FREE_FORMATS.includes(f)

  const toggle = (f: ExportFormat): void => {
    if (locked(f)) return
    setFormats((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.chooseExportDir()
    if (dir) setOutDir(dir)
  }

  const run = async (): Promise<void> => {
    if (!outDir || formats.size === 0) return
    setRunning(true)
    setResult(null)
    const res = await window.api.exportSession({
      outDir,
      formats: [...formats],
      numbering,
      captions
    })
    setResult(res)
    setRunning(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{t('export.title')}</strong>
          <span className="muted">· {t('gallery.count', { count })}</span>
        </div>

        <div className="modal-body">
          <div className="field-label">{t('export.formats')}</div>
          <div className="format-grid">
            {ALL_FORMATS.map((f) => (
              <label
                key={f}
                className={`fmt ${formats.has(f) ? 'on' : ''} ${locked(f) ? 'locked' : ''}`}
                title={locked(f) ? t('export.proOnly') : undefined}
              >
                <input
                  type="checkbox"
                  checked={formats.has(f)}
                  disabled={locked(f)}
                  onChange={() => toggle(f)}
                />
                {t(`export.fmt.${f}`)}
                {locked(f) && <span className="pro-chip">Pro</span>}
              </label>
            ))}
          </div>
          {!pro && <p className="watermark-note">{t('export.freeNote')}</p>}

          <div className="opt-row">
            <label className="chk">
              <input type="checkbox" checked={numbering} onChange={(e) => setNumbering(e.target.checked)} />
              {t('export.numbering')}
            </label>
            <label className="chk">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              {t('export.captions')}
            </label>
          </div>

          <div className="field-label">{t('export.folder')}</div>
          <div className="folder-row">
            <input className="folder-path" readOnly value={outDir ?? ''} placeholder={t('export.chooseFolder')} />
            <button className="btn sm" onClick={chooseDir}>
              {t('export.chooseFolder')}
            </button>
          </div>

          {result && (
            <div className={`result ${result.ok ? 'ok' : 'err'}`}>
              {result.ok ? (
                <>
                  ✅ {t('export.done', { count: result.count, files: result.files.length })}{' '}
                  <button className="link" onClick={() => window.api.openPath(result.outDir)}>
                    {t('export.openFolder')}
                  </button>
                </>
              ) : (
                <>❌ {result.error}</>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            {t('export.close')}
          </button>
          <button
            className="btn primary"
            disabled={!outDir || formats.size === 0 || running}
            onClick={run}
          >
            {running ? t('export.running') : t('export.run')}
          </button>
        </div>
      </div>
    </div>
  )
}
