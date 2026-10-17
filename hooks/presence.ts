// Which of the sessions open on this machine shows notices: the one the person
// touched last (typed, sent a prompt, ran a command) among those still alive.
// A terminal does not tell a mod whether its window has focus, so the last
// touch stands in for it.

export const PRESENCE_PREFIX = "presence:"

/** What each session writes under `presence:<session id>` in the shared store. */
export type Presence = { activeAt: number; aliveAt: number }

export function toPresence(value: unknown): Presence | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { activeAt, aliveAt } = value as Record<string, unknown>
  return typeof activeAt === "number" && typeof aliveAt === "number" ? { activeAt, aliveAt } : undefined
}

/**
 * The id of the session that shows notices: alive within `staleMs`, touched
 * last, the larger id on a tie so every session picks the same one.
 */
export function pickActive(entries: ReadonlyArray<readonly [string, Presence]>, now: number, staleMs: number): string | undefined {
  let best: readonly [string, Presence] | undefined
  for (const entry of entries) {
    const [id, presence] = entry
    if (now - presence.aliveAt > staleMs) continue
    if (best === undefined || presence.activeAt > best[1].activeAt || (presence.activeAt === best[1].activeAt && id > best[0])) best = entry
  }

  return best?.[0]
}
