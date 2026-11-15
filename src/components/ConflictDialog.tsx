import { useEffect, useId, useRef } from 'react'
import { useI18n } from '../i18n'
import type { Conflict } from '../state/store'
import { Icon } from './ui/Icon'

interface Props {
  conflict: Conflict | null
  /** The last choice could not be carried out safely; nothing was changed. */
  error: boolean
  onResolve: (choice: 'other' | 'mine') => boolean
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
              {t.sync.failed}
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
