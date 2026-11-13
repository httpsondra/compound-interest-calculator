import { useI18n, type Lang } from '../i18n'
import { Icon, LogoMark } from './ui/Icon'

export type View = 'plan' | 'compare' | 'risk'
export type Theme = 'system' | 'light' | 'dark'

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

export function Header({
  view,
  onView,
  lang,
  onLang,
  theme,
  onTheme,
  onShare,
}: {
  view: View
  onView: (v: View) => void
  lang: Lang
  onLang: (l: Lang) => void
  theme: Theme
  onTheme: (t: Theme) => void
  onShare: () => void
}) {
  const { t } = useI18n()
  const views: View[] = ['plan', 'compare', 'risk']
  return (
    <header className="header">
      <div className="header-inner">
        <a className="brand" href="./" onClick={(e) => (e.preventDefault(), onView('plan'))}>
          <LogoMark size={28} />
          <span className="brand-name">
            Invest<span>Calc</span>
          </span>
        </a>
        <nav className="nav" aria-label={t.app.navLabel} style={{ ['--i' as string]: views.indexOf(view) }}>
          <span className="nav-thumb" aria-hidden="true" />
          {views.map((v) => (
            <a
              key={v}
              href={v === 'plan' ? './' : `#/${v}`}
              className="nav-link"
              aria-current={view === v ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                onView(v)
              }}
            >
              {t.app.nav[v]}
            </a>
          ))}
        </nav>
        <div className="header-tools">
          <button type="button" className="btn btn--ghost btn--sm header-share" onClick={onShare} aria-label={t.app.share}>
            <Icon name="share" size={16} />
            <span className="hide-sm">{t.app.share}</span>
          </button>
          <div className="lang-toggle" role="group" aria-label={t.app.language}>
            {(['cs', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={lang === l}
                aria-label={l === 'cs' ? 'CS – Čeština' : 'EN – English'}
                onClick={() => onLang(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onTheme(NEXT_THEME[theme])}
            aria-label={`${t.app.theme.label}: ${t.app.theme[theme]}`}
            title={t.app.theme[theme]}
          >
            <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} size={18} />
          </button>
        </div>
      </div>
    </header>
  )
}
