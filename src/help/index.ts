import type { Lang } from '../i18n'
import { helpCs } from './content.cs'
import { helpEn } from './content.en'
import type { HelpBody, HelpContent, HelpCtx, HelpId } from './types'

export { HELP_IDS, type HelpId, type HelpBody, type HelpCtx } from './types'

const CONTENT: Record<Lang, HelpContent> = { en: helpEn, cs: helpCs }

export function getHelp(lang: Lang, id: HelpId, ctx: HelpCtx): HelpBody {
  return CONTENT[lang][id](ctx)
}
