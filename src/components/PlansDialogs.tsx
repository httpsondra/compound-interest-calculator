import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { parseStoredRaw, type Doc, type Store } from '../state/store'
import { applyImport, MAX_SCENARIOS, parseImport, type ImportError } from '../state/plans'
import type { BackupRec } from '../state/storage'
import { Icon } from './ui/Icon'

/**
 * Modal shell for the saved-plans dialogs. Native <dialog>: focus is trapped while open, Escape closes, focus returns to
 * the control that opened it. (The conflict dialog is deliberately not dismissible; these are.)
 */
function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    else if (!open && dlg.open) dlg.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog share-dialog data-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={(e) => {
        // Tab and Shift+Tab wrap inside the dialog (same rule as the conflict dialog), so focus never reaches the page behind.
        if (e.key !== 'Tab' || !ref.current) return
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [href]'))
        if (items.length === 0) return
        e.preventDefault()
        const idx = items.indexOf(document.activeElement as HTMLElement)
        let next = idx === -1 ? (e.shiftKey ? items.length - 1 : 0) : idx + (e.shiftKey ? -1 : 1)
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        items[next].focus()
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={titleId} className="section-title">
              {title}
            </h2>
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t.common.close} onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}

const summary = (doc: Doc | null) => (doc ? doc.scenarios.map((s) => s.name || '·').join(', ') : '')

/** Saved plans → Recover previous version. */
export function RecoverDialog({ open, onClose, store, toast }: { open: boolean; onClose: () => void; store: Store; toast: (s: string) => void }) {
  const { t, fill, lang } = useI18n()
  const [list, setList] = useState<BackupRec[] | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const { listBackups } = store // stable: the dialog's state must not reset when the app re-renders

  useEffect(() => {
    if (!open) return
    setList(null)
    setPicked(null)
    setConfirming(false)
    setFailed(false)
    let live = true
    void listBackups().then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [open, listBackups])

  const fmt = (at: number) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
  const parsed = (b: BackupRec) => parseStoredRaw(b.raw)
  const chosen = list?.find((b) => b.id === picked) ?? null
  const chosenDoc = chosen ? parsed(chosen) : null

  const restore = async () => {
    if (!chosenDoc) return
    setBusy(true)
    const ok = await store.applyDoc(chosenDoc, 'restore')
    setBusy(false)
    if (ok) {
      toast(t.data.restored)
      onClose()
    } else setFailed(true)
  }

  return (
    <Modal open={open} title={t.data.recoverTitle} onClose={onClose}>
      <p className="share-body">{t.data.recoverIntro}</p>
      {list === null ? (
        <p className="share-meta" role="status">
          {t.data.loading}
        </p>
      ) : list.length === 0 ? (
        <p className="share-meta">{t.data.recoverEmpty}</p>
      ) : confirming && chosenDoc ? (
        <>
          <h3 className="mini-title">{t.data.confirmTitle}</h3>
          <p className="share-body">{fill(t.data.confirmBody, { n: store.doc.scenarios.length })}</p>
          <div className="share-incoming">
            <span className="share-k">{t.data.contents}</span>
            <strong>{summary(chosenDoc)}</strong>
          </div>
          {failed && (
            <p className="share-warn" role="alert">
              <Icon name="warning" size={14} />
              {t.data.restoreFailed}
            </p>
          )}
          <div className="share-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)} disabled={busy}>
              {t.data.back}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void restore()} disabled={busy}>
              {t.data.confirmYes}
            </button>
          </div>
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label={t.data.recoverTitle} className="backup-list">
            {list.map((b) => {
              const doc = parsed(b)
              return (
                <label key={b.id} className={`backup-row${picked === b.id ? ' is-picked' : ''}`}>
                  <input type="radio" name="backup" checked={picked === b.id} onChange={() => setPicked(b.id)} />
                  <span className="backup-main">
                    <span className="backup-when">{fmt(b.at)}</span>
                    <span className="backup-kind">{t.data.kind[b.kind]}</span>
                    <span className="backup-names">{doc ? `${fill(t.data.plansCount, { n: doc.scenarios.length })} · ${summary(doc)}` : t.data.unreadableCopy}</span>
                  </span>
                </label>
              )
            })}
          </div>
          <p className="share-meta">{t.data.browserOnly}</p>
          <div className="share-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {t.common.close}
            </button>
            <button type="button" className="btn btn--primary" disabled={!chosenDoc} onClick={() => setConfirming(true)}>
              {t.data.restore}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Saved plans → Import plans. */
export function ImportDialog({ open, onClose, store, toast }: { open: boolean; onClose: () => void; store: Store; toast: (s: string) => void }) {
  const { t, fill } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<ImportError | null>(null)
  const [parsed, setParsed] = useState<{ doc: Doc; legacy: boolean; skipped: number } | null>(null)
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setParsed(null)
    setFailed(false)
    setBusy(false)
  }, [open])

  const room = Math.max(0, MAX_SCENARIOS - store.doc.scenarios.length)

  const onFile = async (file: File | undefined) => {
    setFailed(false)
    if (!file) return
    const text = file.size > 1_500_000 ? 'x'.repeat(1_500_001) : await file.text()
    const r = parseImport(text)
    if (!r.ok) {
      setParsed(null)
      setError(r.error)
      return
    }
    setError(null)
    setParsed({ doc: r.doc, legacy: r.legacy, skipped: r.skipped })
    setMode(room > 0 ? 'add' : 'replace')
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    const { doc, added } = applyImport(store.doc, parsed.doc, mode)
    const ok = await store.applyDoc(doc, 'import')
    setBusy(false)
    if (ok) {
      toast(fill(t.data.imported, { n: added }))
      onClose()
    } else setFailed(true)
  }

  const dropped = parsed && mode === 'add' ? Math.max(0, parsed.doc.scenarios.length - room) : 0
  return (
    <Modal open={open} title={t.data.importTitle} onClose={onClose}>
      <p className="share-body">{t.data.importIntro}</p>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="share-actions share-actions--start">
        <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
          <Icon name="open" size={15} />
          {parsed ? t.data.chooseOther : t.data.chooseFile}
        </button>
      </div>
      {error && (
        <p className="share-warn" role="alert">
          <Icon name="warning" size={14} />
          {fill(t.data.errors[error], { max: MAX_SCENARIOS })}
        </p>
      )}
      {parsed && (
        <>
          <div className="share-incoming">
            <span className="share-k">{t.data.inFile}</span>
            <strong>{summary(parsed.doc)}</strong>
          </div>
          {parsed.legacy && <p className="share-meta">{t.data.legacy}</p>}
          {parsed.skipped > 0 && <p className="share-meta">{fill(t.data.skipped, { n: parsed.skipped })}</p>}
          <fieldset className="mode-set">
            <legend className="mini-title">{t.data.mode}</legend>
            <label className={`backup-row${mode === 'add' ? ' is-picked' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'add'} disabled={room === 0} onChange={() => setMode('add')} />
              <span className="backup-main">
                <span className="backup-when">{t.data.modeAdd}</span>
                <span className="backup-names">{room === 0 ? t.data.noRoom : fill(t.data.modeAddHint, { room })}</span>
              </span>
            </label>
            <label className={`backup-row${mode === 'replace' ? ' is-picked' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span className="backup-main">
                <span className="backup-when">{t.data.modeReplace}</span>
                <span className="backup-names">{t.data.modeReplaceHint}</span>
              </span>
            </label>
          </fieldset>
          {dropped > 0 && <p className="share-meta">{fill(t.data.dropped, { n: dropped, max: MAX_SCENARIOS })}</p>}
        </>
      )}
      {failed && (
        <p className="share-warn" role="alert">
          <Icon name="warning" size={14} />
          {t.data.importFailed}
        </p>
      )}
      <div className="share-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          {t.common.close}
        </button>
        <button type="button" className="btn btn--primary" disabled={!parsed || busy || (mode === 'add' && room === 0)} onClick={() => void confirm()}>
          {t.data.importConfirm}
        </button>
      </div>
    </Modal>
  )
}
