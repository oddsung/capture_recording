import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, CaptureItem, CaptureStatus } from '@shared/types'
import { Header } from './components/Header'
import { ControlBar } from './components/ControlBar'
import { Gallery } from './components/Gallery'
import { SettingsPanel } from './components/SettingsPanel'
import { Editor } from './components/Editor'
import { ExportModal } from './components/ExportModal'

type Tab = 'capture' | 'settings'

export default function App(): JSX.Element {
  const { i18n } = useTranslation()
  const [tab, setTab] = useState<Tab>('capture')
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [items, setItems] = useState<CaptureItem[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)

  // Initial load + subscriptions.
  useEffect(() => {
    void (async () => {
      setStatus(await window.api.getStatus())
      setItems(await window.api.getItems())
      const s = await window.api.getSettings()
      setSettings(s)
      void i18n.changeLanguage(s.language)
    })()

    const offStatus = window.api.onStatusChanged(setStatus)
    const offAdded = window.api.onCaptureAdded((item) =>
      setItems((prev) => [...prev, item])
    )
    const offSettings = window.api.onSettingsChanged((s) => {
      setSettings(s)
      void i18n.changeLanguage(s.language)
    })
    const offRemoved = window.api.onItemRemoved((id) =>
      setItems((prev) => prev.filter((i) => i.id !== id))
    )
    return () => {
      offStatus()
      offAdded()
      offSettings()
      offRemoved()
    }
  }, [i18n])

  const applyTheme = useCallback((theme: string) => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [])

  useEffect(() => {
    if (settings) applyTheme(settings.theme)
  }, [settings, applyTheme])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.updateSettings(patch)
    setSettings(next)
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await window.api.deleteItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clearAll = useCallback(async () => {
    await window.api.clearSession()
    setItems([])
  }, [])

  const reorder = useCallback(async (ids: string[]) => {
    const next = await window.api.reorder(ids)
    setItems(next)
  }, [])

  const cleanDuplicates = useCallback(async () => {
    const next = await window.api.cleanDuplicates()
    setItems(next)
  }, [])

  const onItemSaved = useCallback((updated: CaptureItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }, [])

  if (!settings) return <div className="loading">…</div>

  const editingItem = editingId ? items.find((i) => i.id === editingId) ?? null : null

  return (
    <div className="app">
      <Header status={status} tab={tab} onTab={setTab} />
      {tab === 'capture' ? (
        <>
          <ControlBar
            status={status}
            onStart={() => window.api.start()}
            onStartRegion={() => window.api.startWithRegion()}
            onStop={() => window.api.stop()}
            onPause={() => window.api.pause()}
            onResume={() => window.api.resume()}
            onManual={() => window.api.manualCapture()}
          />
          <Gallery
            items={items}
            onOpen={setEditingId}
            onDelete={deleteItem}
            onClear={clearAll}
            onOpenFolder={() => window.api.openSaveDir()}
            onReorder={reorder}
            onCleanDuplicates={cleanDuplicates}
            onExport={() => setShowExport(true)}
          />
        </>
      ) : (
        <SettingsPanel settings={settings} onChange={updateSettings} />
      )}

      {editingItem && (
        <Editor
          key={editingItem.id}
          item={editingItem}
          index={items.findIndex((i) => i.id === editingItem.id) + 1}
          total={items.length}
          onPrev={() => {
            const i = items.findIndex((it) => it.id === editingItem.id)
            if (i > 0) setEditingId(items[i - 1].id)
          }}
          onNext={() => {
            const i = items.findIndex((it) => it.id === editingItem.id)
            if (i >= 0 && i < items.length - 1) setEditingId(items[i + 1].id)
          }}
          onClose={() => setEditingId(null)}
          onSaved={onItemSaved}
        />
      )}

      {showExport && (
        <ExportModal settings={settings} count={items.length} onClose={() => setShowExport(false)} />
      )}
    </div>
  )
}
