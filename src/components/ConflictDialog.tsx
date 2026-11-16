import { useEffect, useId, useRef } from 'react'
import { useI18n } from '../i18n'
import type { Conflict, ConflictError } from '../state/store'
import { Icon } from './ui/Icon'

interface Props {
  conflict: Conflict | null
  /** The last choice was refused, and nothing was changed. */
  error: ConflictError
  onResolve: (choice: 'other' | 'mine') => Promise<boolean>
}

/**
 * Shown when another tab saved plans while this tab had unsaved changes. Modal and not dismissible
 * with Escape: the user must choose. Neither choice discards data: the version not kept is saved as
 * a backup in this browser.
 */
export function ConflictDialog({ conflict, error, onResolve }: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const firstBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const open = conflict != null

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.showModal()
      firstBtn.current?.focus()
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open])

  const names = (docs: { scenarios: { name: string }[] } | undefined) =>
    (docs?.scenarios ?? []).map((x) => x.name || t.scenario.untitled).join(', ')

  return (
    <dialog
      ref={ref}
      className="dialog share-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => e.preventDefault()}
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
        if (!document.activeElement || document.activeElement === document.body) document.getElementById('main')?.focus()
      }}
    >
      {conflict && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <h2 id={titleId} className="section-title">
              {t.sync.title}
            </h2>
          </header>
          <p id={bodyId} className="share-body">
            {t.sync.body}
          </p>
          <div className="share-incoming">
            <span className="share-k">{t.sync.thisTab}</span>
            <strong>{names(conflict.mine)}</strong>
          </div>
          <div className="share-incoming">
            <span className="share-k">{t.sync.otherTab}</span>
            <strong>{names(conflict.theirs)}</strong>
          </div>
          <p className="share-meta">{t.sync.note}</p>
          {error && (
            <p className="share-warn" role="alert">
              <Icon name="warning" size={14} />
              {error === 'unreadable' ? t.sync.unreadable : t.sync.failed}
            </p>
          )}
          <div className="share-actions">
            <button ref={firstBtn} type="button" className="btn btn--ghost" onClick={() => onResolve('other')}>
              <Icon name="reset" size={15} />
              {t.sync.useOther}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => onResolve('mine')}>
              {t.sync.keepMine}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
