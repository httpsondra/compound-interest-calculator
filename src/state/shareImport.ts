import { MAX_SCENARIOS, type Doc } from './store'
import type { Scenario } from '../model/scenario'

/*
 * Shared-plan import rules (pure, unit-tested).
 *
 * A link from someone else must never delete saved work on its own. Below the limit the plan is
 * added (undoable). At the limit the user chooses which saved plan is replaced. The choice is
 * stored as a scenario ID, never as an array index, so it stays on the same plan whatever happens
 * to the active selection or to the list order while the decision is open.
 */

export interface PendingImport {
  incoming: Scenario
  /** Saved plan the user proposed to replace; null when none is valid any more. */
  targetId: string | null
}

/** True when importing would exceed the saved-plan limit. */
export function importNeedsChoice(doc: Doc, incoming: Scenario): boolean {
  return doc.scenarios.filter((x) => x.id !== incoming.id).length >= MAX_SCENARIOS
}

/** Default proposal: the oldest saved plan that is not the active one. */
export function defaultTarget(doc: Doc): string | null {
  const other = doc.scenarios.find((x) => x.id !== doc.activeId)
  return (other ?? doc.scenarios[0])?.id ?? null
}

/** Whether the planned target still exists in the current document. */
export function targetExists(doc: Doc, targetId: string | null): boolean {
  return targetId != null && doc.scenarios.some((x) => x.id === targetId)
}

/** Add without replacing anything (only valid below the limit). */
export function addScenario(doc: Doc, incoming: Scenario): Doc {
  return { scenarios: [...doc.scenarios.filter((x) => x.id !== incoming.id), incoming], activeId: incoming.id }
}

/**
 * Replace exactly the plan with `targetId` (same position). Returns null, and changes nothing, if
 * that plan no longer exists: the caller must ask the user to choose again.
 */
export function replaceScenario(doc: Doc, targetId: string, incoming: Scenario): Doc | null {
  if (!targetExists(doc, targetId)) return null
  const scenarios = doc.scenarios.map((x) => (x.id === targetId ? incoming : x)).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i)
  return { scenarios, activeId: incoming.id }
}
