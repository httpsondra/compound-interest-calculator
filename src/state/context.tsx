import { createContext, useContext } from 'react'
import type { Computed } from '../model/compute'
import type { Scenario } from '../model/scenario'
import type { Store } from './store'

export interface AppCtxValue {
  store: Store
  scenario: Scenario
  update: Store['update']
  computed: Computed
  /** True while the deferred computation lags behind the latest input. */
  stale: boolean
  showReal: boolean
  setShowReal: (v: boolean) => void
  toast: (text: string, action?: { label: string; run: () => void }) => void
}

export const AppCtx = createContext<AppCtxValue | null>(null)

export function useApp(): AppCtxValue {
  const v = useContext(AppCtx)
  if (!v) throw new Error('AppCtx missing')
  return v
}
