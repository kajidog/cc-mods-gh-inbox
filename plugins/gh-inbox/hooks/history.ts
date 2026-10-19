// What every session keeps in the shared store, so `/inbox log` lists the notices of other
// sessions and of the time no session was open.
import type { GhEvent } from "../types"

import { mergeSeen } from "./events"

export const HISTORY_KEY = "history"
export const HISTORY_KEPT = 200
/** The ids any session has seen, one key per pull request or `repo:host/owner/repo`, as a session's own seen ids are keyed. */
export const SHARED_SEEN_PREFIX = "shared-seen:"
// Seen ids no session has looked at for this long are dropped: what came after is not caught up.
export const SHARED_SEEN_KEPT_MS = 30 * 24 * 60 * 60 * 1000

export type SharedSeen = { at: number; ids: string[] }

const isEvent = (value: unknown): value is GhEvent => {
  if (typeof value !== "object" || value === null) return false
  const { id, pull, text, url, at } = value as Record<string, unknown>
  return typeof id === "string" && typeof pull === "string" && typeof text === "string" && typeof url === "string" && typeof at === "string"
}

export const toHistory = (value: unknown): GhEvent[] => (Array.isArray(value) ? value.filter(isEvent) : [])

export function toSharedSeen(value: unknown): SharedSeen | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { at, ids } = value as { at?: unknown; ids?: unknown }
  if (typeof at !== "number" || !Array.isArray(ids)) return undefined
  return { at, ids: ids.filter((id): id is string => typeof id === "string") }
}

const eventKey = (event: GhEvent) => `${event.pull}|${event.id}`

/** The `added` that `held` does not hold yet, each once. */
export function unheld(held: readonly GhEvent[], added: readonly GhEvent[]): GhEvent[] {
  const keys = new Set(held.map(eventKey))

  return added.filter(event => {
    const key = eventKey(event)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

/** `held` with the `added` it does not hold yet, the newest `HISTORY_KEPT` kept. */
export const addToHistory = (held: readonly GhEvent[], added: readonly GhEvent[]) => [...held, ...unheld(held, added)].slice(-HISTORY_KEPT)

/** `seen` with `ids` added, looked at `now`. */
export const addSharedSeen = (seen: SharedSeen | undefined, ids: readonly string[], now: number): SharedSeen => ({
  at: now,
  ids: mergeSeen(seen?.ids ?? [], ids),
})

/** The newest `count` of `history`, oldest first by when they happened; one with no time goes with the one added before it. */
export function latest(history: readonly GhEvent[], count: number): GhEvent[] {
  let before = Number.NEGATIVE_INFINITY
  const timed = history.map((event, index) => {
    const at = Date.parse(event.at)
    if (!Number.isNaN(at)) before = at
    return { event, index, at: before }
  })
  timed.sort((a, b) => a.at - b.at || a.index - b.index)

  return timed.slice(-count).map(({ event }) => event)
}

/** One notice as `/inbox log` lists it: `when` as `t.paren` wrote it, or empty. */
export type LogRow = { text: string; url: string; when: string }

/** `/inbox log`'s text: each notice on a line, its URL and when it happened under it. */
export const logText = (rows: readonly LogRow[]) => rows.map(row => `${row.text}\n  ${row.url}${row.when}`).join("\n")

/** The rows `logText` wrote, or undefined for any other text. */
export function parseLog(text: string): LogRow[] | undefined {
  const lines = text.split("\n")
  if (lines.length % 2 !== 0) return undefined
  const rows: LogRow[] = []
  for (let i = 0; i < lines.length; i += 2) {
    const match = /^ {2}(\S+?)((?: \(|（).*)?$/.exec(lines[i + 1] ?? "")
    if (match === null) return undefined
    rows.push({ text: lines[i] ?? "", url: match[1] ?? "", when: match[2] ?? "" })
  }

  return rows
}
