import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, CaptureMode, Language, OutputFormat, Theme } from '@shared/types'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

function Toggle({
  label,
  checked,
  onChange,
  hint
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}): JSX.Element {
  return (
    <label className="toggle">
      <span className="toggle-label">
        {label}
        {hint && <em className="soon">{hint}</em>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  mono
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        className={mono ? 'mono' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function SettingsPanel({ settings, onChange }: Props): JSX.Element {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<string[]>([])
  const [profileName, setProfileName] = useState('')
  const [newExclusion, setNewExclusion] = useState('')

  useEffect(() => {
    void window.api.listProfiles().then(setProfiles)
  }, [])

  const saveProfile = async (): Promise<void> => {
    if (!profileName.trim()) return
    setProfiles(await window.api.saveProfile(profileName.trim()))
    setProfileName('')
  }
  const applyProfile = (name: string): void => {
    if (name) void window.api.applyProfile(name) // main broadcasts ON_SETTINGS_CHANGED
  }
  const deleteProfile = async (name: string): Promise<void> => {
    if (name) setProfiles(await window.api.deleteProfile(name))
  }

  const addExclusion = (): void => {
    const v = newExclusion.trim()
    if (!v || settings.exclusions.includes(v)) return
    onChange({ exclusions: [...settings.exclusions, v] })
    setNewExclusion('')
  }
  const removeExclusion = (v: string): void =>
    onChange({ exclusions: settings.exclusions.filter((e) => e !== v) })

  return (
    <section className="settings">
      <div className="group">
        <h3>{t('settings.profiles')}</h3>
        <div className="field">
          <span>{t('settings.savedProfiles')}</span>
          <select defaultValue="" onChange={(e) => applyProfile(e.target.value)}>
            <option value="" disabled>
              {profiles.length ? t('settings.apply') : t('settings.noProfiles')}
            </option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-add">
          <input
            type="text"
            placeholder={t('settings.newProfile')}
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <button className="btn sm" onClick={saveProfile}>
            {t('settings.saveProfile')}
          </button>
        </div>
        {profiles.length > 0 && (
          <div className="chips">
            {profiles.map((p) => (
              <span key={p} className="chip">
                {p}
                <button onClick={() => deleteProfile(p)}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="group">
        <h3>{t('settings.general')}</h3>
        <div className="field">
          <span>{t('settings.language')}</span>
          <select
            value={settings.language}
            onChange={(e) => onChange({ language: e.target.value as Language })}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="field">
          <span>{t('settings.theme')}</span>
          <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Theme })}>
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </div>
        <Toggle
          label={t('settings.startWithWindows')}
          checked={settings.startWithWindows}
          onChange={(v) => onChange({ startWithWindows: v })}
        />
        <Toggle
          label={t('settings.minimizeToTray')}
          checked={settings.minimizeToTray}
          onChange={(v) => onChange({ minimizeToTray: v })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.capture')}</h3>
        <div className="field">
          <span>{t('settings.captureMode')}</span>
          <select
            value={settings.capture.mode}
            onChange={(e) =>
              onChange({ capture: { ...settings.capture, mode: e.target.value as CaptureMode } })
            }
          >
            <option value="fullscreen">{t('captureMode.fullscreen')}</option>
            <option value="window">{t('captureMode.window')}</option>
            <option value="element">{t('captureMode.element')}</option>
            <option value="cursor">{t('captureMode.cursor')}</option>
          </select>
        </div>
        <div className="field">
          <span>{t('settings.format')}</span>
          <select
            value={settings.capture.format}
            onChange={(e) =>
              onChange({ capture: { ...settings.capture, format: e.target.value as OutputFormat } })
            }
          >
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
            <option value="webp">WebP</option>
          </select>
        </div>
        <NumberField
          label={t('settings.quality')}
          value={settings.capture.quality}
          min={1}
          max={100}
          onChange={(v) => onChange({ capture: { ...settings.capture, quality: v } })}
        />
        <NumberField
          label={t('settings.scale')}
          value={settings.capture.scale}
          min={0.25}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ capture: { ...settings.capture, scale: v } })}
        />
        <NumberField
          label={t('settings.elementPadding')}
          value={settings.capture.elementPadding}
          min={0}
          max={64}
          onChange={(v) => onChange({ capture: { ...settings.capture, elementPadding: v } })}
        />
        <NumberField
          label={t('settings.cursorAreaSize')}
          value={settings.capture.cursorAreaSize}
          min={120}
          max={1600}
          step={20}
          onChange={(v) => onChange({ capture: { ...settings.capture, cursorAreaSize: v } })}
        />
        <Toggle
          label={t('settings.fastGrab')}
          hint={t('settings.fastGrabHint')}
          checked={settings.capture.fastGrab}
          onChange={(v) => onChange({ capture: { ...settings.capture, fastGrab: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.border')}</h3>
        <label className="field">
          <span>{t('settings.borderColor')}</span>
          <input
            type="color"
            value={settings.border.color}
            onChange={(e) => onChange({ border: { ...settings.border, color: e.target.value } })}
          />
        </label>
        <NumberField
          label={t('settings.thickness')}
          value={settings.border.thickness}
          min={1}
          max={20}
          onChange={(v) => onChange({ border: { ...settings.border, thickness: v } })}
        />
        <NumberField
          label={t('settings.radius')}
          value={settings.border.radius}
          min={0}
          max={40}
          onChange={(v) => onChange({ border: { ...settings.border, radius: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.triggers')}</h3>
        <Toggle
          label={t('triggers.leftClick')}
          checked={settings.triggers.leftClick}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, leftClick: v } })}
        />
        <Toggle
          label={t('triggers.rightClick')}
          checked={settings.triggers.rightClick}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, rightClick: v } })}
        />
        <Toggle
          label={t('triggers.doubleClick')}
          checked={settings.triggers.doubleClick}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, doubleClick: v } })}
        />
        <Toggle
          label={t('triggers.textCommit')}
          checked={settings.triggers.textCommit}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, textCommit: v } })}
        />
        <NumberField
          label={t('settings.debounce')}
          value={settings.triggers.debounceMs}
          min={0}
          max={2000}
          step={50}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, debounceMs: v } })}
        />
        <NumberField
          label={t('settings.captureDelay')}
          value={settings.triggers.captureDelayMs}
          min={0}
          max={1000}
          step={50}
          onChange={(v) => onChange({ triggers: { ...settings.triggers, captureDelayMs: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.effect')}</h3>
        <Toggle
          label={t('effect.flash')}
          checked={settings.effect.flash}
          onChange={(v) => onChange({ effect: { ...settings.effect, flash: v } })}
        />
        <div className="field">
          <span>{t('settings.flashStyle')}</span>
          <select
            value={settings.effect.flashStyle}
            onChange={(e) =>
              onChange({
                effect: { ...settings.effect, flashStyle: e.target.value as 'flash' | 'pulse' | 'frame' }
              })
            }
          >
            <option value="frame">{t('settings.fxFrame')}</option>
            <option value="flash">{t('settings.fxFlash')}</option>
          </select>
        </div>
        <Toggle
          label={t('effect.toast')}
          checked={settings.effect.toast}
          onChange={(v) => onChange({ effect: { ...settings.effect, toast: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.features')}</h3>
        <Toggle
          label={t('features.autoNumber')}
          checked={settings.features.autoNumber}
          onChange={(v) => onChange({ features: { ...settings.features, autoNumber: v } })}
        />
        <Toggle
          label={t('features.autoCaption')}
          checked={settings.features.autoCaption}
          onChange={(v) => onChange({ features: { ...settings.features, autoCaption: v } })}
        />
        <Toggle
          label={t('features.sensitiveBlur')}
          checked={settings.features.sensitiveBlur}
          onChange={(v) => onChange({ features: { ...settings.features, sensitiveBlur: v } })}
        />
        <Toggle
          label={t('features.duplicateDetection')}
          checked={settings.features.duplicateDetection}
          onChange={(v) => onChange({ features: { ...settings.features, duplicateDetection: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.hotkeys')}</h3>
        <Toggle
          label={t('settings.hotkeysEnabled')}
          checked={settings.hotkeys.enabled}
          onChange={(v) => onChange({ hotkeys: { ...settings.hotkeys, enabled: v } })}
        />
        <TextField
          label={t('settings.hkStartStop')}
          mono
          value={settings.hotkeys.startStop}
          onChange={(v) => onChange({ hotkeys: { ...settings.hotkeys, startStop: v } })}
        />
        <TextField
          label={t('settings.hkPauseResume')}
          mono
          value={settings.hotkeys.pauseResume}
          onChange={(v) => onChange({ hotkeys: { ...settings.hotkeys, pauseResume: v } })}
        />
        <TextField
          label={t('settings.hkManual')}
          mono
          value={settings.hotkeys.manualCapture}
          onChange={(v) => onChange({ hotkeys: { ...settings.hotkeys, manualCapture: v } })}
        />
        <TextField
          label={t('settings.hkDeleteLast')}
          mono
          value={settings.hotkeys.deleteLast}
          onChange={(v) => onChange({ hotkeys: { ...settings.hotkeys, deleteLast: v } })}
        />
      </div>

      <div className="group">
        <h3>{t('settings.exclusions')}</h3>
        <p className="hint" style={{ textAlign: 'left' }}>
          {t('settings.exclusionsHint')}
        </p>
        <div className="inline-add">
          <input
            type="text"
            placeholder={t('settings.addExclusion')}
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
          />
          <button className="btn sm" onClick={addExclusion}>
            +
          </button>
        </div>
        {settings.exclusions.length > 0 && (
          <div className="chips">
            {settings.exclusions.map((e) => (
              <span key={e} className="chip">
                {e}
                <button onClick={() => removeExclusion(e)}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="group">
        <h3>{t('settings.storage')}</h3>
        <TextField
          label={t('settings.fileNamePattern')}
          mono
          value={settings.storage.fileNamePattern}
          onChange={(v) => onChange({ storage: { ...settings.storage, fileNamePattern: v } })}
        />
        <p className="soon" style={{ marginTop: 0 }}>
          {t('settings.fileNamePatternHint')}
        </p>
      </div>

      <div className="group">
        <h3>{t('settings.exportDefaults')}</h3>
        <Toggle
          label={t('export.fmt.png')}
          checked={settings.exportFormats.images}
          onChange={(v) => onChange({ exportFormats: { ...settings.exportFormats, images: v } })}
        />
        <Toggle
          label={t('export.fmt.pdf')}
          checked={settings.exportFormats.pdf}
          onChange={(v) => onChange({ exportFormats: { ...settings.exportFormats, pdf: v } })}
        />
        <Toggle
          label="HTML / Markdown"
          checked={settings.exportFormats.htmlMarkdown}
          onChange={(v) =>
            onChange({ exportFormats: { ...settings.exportFormats, htmlMarkdown: v } })
          }
        />
        <Toggle
          label="DOCX / PPTX"
          checked={settings.exportFormats.office}
          onChange={(v) => onChange({ exportFormats: { ...settings.exportFormats, office: v } })}
        />
      </div>
    </section>
  )
}
