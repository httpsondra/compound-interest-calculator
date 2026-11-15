import { useEffect, useId, useRef } from 'react'
import { useI18n } from '../i18n'
import { MAX_SCENARIOS } from '../state/store'
import { targetExists, type PendingImport } from '../state/shareImport'
import type { Scenario } from '../model/scenario'
import { Icon } from './ui/Icon'

interface Props {
  pending: PendingImport | null
  scenarios: Scenario[]
  onChoose: (id: string) => void
  onConfirm: (targetId: string) => void
  onCancel: () => void
}

/**
 * Confirmation for importing a shared calculation when the saved-plan limit is reached.
 * Native modal <dialog>: focus is trapped while open, Escape cancels, and focus returns to the
 * previously focused element when it closes. Cancel is the initial focus (the safe choice).
 */
export function ShareImportDialog({ pending, scenarios, onChoose, onConfirm, onCancel }: Props) {
  const { t, f, fill, years } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const cancelBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const open = pending != null

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.showModal()
      cancelBtn.current?.focus()
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open])

  const targetOk = pending ? targetExists({ scenarios, activeId: '' }, pending.targetId) : false
  const name = (s: Scenario) => s.name || t.scenario.untitled

  return (
    <dialog
      ref={ref}
      className="dialog share-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={(e) => {
        // Tab order is handled here, not by the browser: Tab and Shift+Tab always move between the
        // dialog's own controls and wrap around, so focus can never leave for the page behind.
        if (e.key !== 'Tab' || !ref.current) return
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href]'))
        if (items.length === 0) return
        e.preventDefault()
        const idx = items.indexOf(document.activeElement as HTMLElement)
        let next = idx === -1 ? (e.shiftKey ? items.length - 1 : 0) : idx + (e.shiftKey ? -1 : 1)
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        items[next].focus()
      }}
      onClose={() => {
        // Escape (or any close) while still pending counts as cancel. Confirm/Cancel clear `pending`
        // first, so this does not run twice.
        if (pending) onCancel()
        // Focus lands on the page when the opener is no longer available.
        if (!document.activeElement || document.activeElement === document.body) document.getElementById('main')?.focus()
      }}
    >
      {pending && (
        // Deliberately not a <form>: pressing Enter on a radio must never submit. Only the explicit
        // "Replace plan" button confirms.
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={titleId} className="section-title">
              {t.app.sharedTitle}
            </h2>
            <button type="button" className="icon-btn" aria-label={t.common.close} onClick={onCancel}>
              <Icon name="close" size={17} />
            </button>
          </header>
          <p id={bodyId} className="share-body">
            {fill(t.app.sharedBody, { max: String(MAX_SCENARIOS) })}
          </p>
          <div className="share-incoming">
            <span className="share-k">{t.app.sharedIncoming}</span>
            <strong>{name(incomingOf(pending))}</strong>
            <span className="share-meta">
              {f.money(incomingOf(pending).initial, incomingOf(pending).currency, { compact: true })} · {years(incomingOf(pending).horizonYears)}
            </span>
          </div>
          <fieldset className="share-choices">
            <legend className="share-k">{t.app.sharedChoose}</legend>
            {scenarios.map((s) => (
              <label key={s.id} className="share-choice">
                <input
                  type="radio"
                  name="share-target"
                  value={s.id}
                  checked={pending.targetId === s.id}
                  onChange={() => onChoose(s.id)}
                />
                <span>{name(s)}</span>
              </label>
            ))}
          </fieldset>
          {!targetOk && (
            <p className="share-warn" role="alert">
              <Icon name="warning" size={14} />
              {t.app.sharedMissing}
            </p>
          )}
          <div className="share-actions">
            <button ref={cancelBtn} type="button" className="btn btn--ghost" onClick={onCancel}>
              {t.app.sharedCancel}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!targetOk}
              onClick={() => {
                if (targetOk && pending.targetId) onConfirm(pending.targetId)
              }}
            >
              {t.app.sharedConfirm}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}

/** The incoming plan is held in `pending`; this accessor keeps the JSX readable. */
function incomingOf(p: PendingImport): Scenario {
  return p.incoming
}
