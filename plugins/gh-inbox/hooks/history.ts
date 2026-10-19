// What every session keeps in the shared store, so `/inbox log` lists the notices of other
// sessions and of the time no session was open.
import type { GhEvent } from "../types"

import { mergeSeen } from "./events"

/** Each session's own notices, under `history:<session id>`: no session writes another's, so none is lost to a race. */
export const HISTORY_PREFIX = "history:"
/** Notices kept per session, the newest by when they happened. */
export const HISTORY_KEPT = 50
/** Sessions whose notices are kept, those written to last. */
export const HISTORIES_KEPT = 20
/** How many notices a session caught up while it was not the one showing them, under `missed:<session id>`. */
export const MISSED_PREFIX = "missed:"
/** The ids any session has seen, one key per pull request or `repo:host/owner/repo`, as a session's own seen ids are keyed. */
export const SHARED_SEEN_PREFIX = "shared-seen:"
// What no session has written to for this long is dropped: seen ids, so what came after is not caught up; a session's notices.
export const SHARED_KEPT_MS = 30 * 24 * 60 * 60 * 1000

export type SharedSeen = { at: number; ids: string[] }
export type SessionHistory = { at: number; events: GhEvent[] }

const isEvent = (value: unknown): value is GhEvent => {
  if (typeof value !== "object" || value === null) return false
  const { id, pull, text, url, at } = value as Record<string, unknown>
  return typeof id === "string" && typeof pull === "string" && typeof text === "string" && typeof url === "string" && typeof at === "string"
}

export function toSessionHistory(value: unknown): SessionHistory | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { at, events } = value as { at?: unknown; events?: unknown }
  if (typeof at !== "number" || !Array.isArray(events)) return undefined
  return { at, events: events.filter(isEvent) }
}

export function toSharedSeen(value: unknown): SharedSeen | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { at, ids } = value as { at?: unknown; ids?: unknown }
  if (typeof at !== "number" || !Array.isArray(ids)) return undefined
  return { at, ids: ids.filter((id): id is string => typeof id === "string") }
}

// `pull` names no host: the URL's tells apart the same repository on two hosts.
const hostOf = (url: string) => /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? ""
// A merge or a close is `merged:#n` or `closed:#n` from a registered repository, `state:merged` or `state:closed` from the branch's pull request.
const sameId = (id: string) => id.replace(/^(merged|closed):#\d+$/, "state:$1")
const eventKey = (event: GhEvent) => `${hostOf(event.url)}|${event.pull}|${sameId(event.id)}`

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

/** Every session's notices together, each once. */
export const mergeHistories = (histories: readonly (readonly GhEvent[])[]) => unheld([], histories.flat())

/** What a session keeps of its notices: the newest `HISTORY_KEPT`, without the bodies only a prompt reads. */
export const toKept = (events: readonly GhEvent[], now: number): SessionHistory => ({
  at: now,
  events: latest(unheld([], events), HISTORY_KEPT).map(event => ({ ...event, items: [] })),
})

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
