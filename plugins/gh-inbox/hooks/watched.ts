// The pull requests `/inbox watch` chose, checked as the branch's is: one GraphQL request each at every check,
// not the Events API. Every session reads the same list.

import type { PullState } from "./github"

/** `{ "host/owner/repo#number": WatchedEntry }`. */
export const WATCHED_KEY = "watched"
/** How many pull requests can be watched: each costs one GraphQL point a check. */
export const WATCHED_MAX = 20
/**
 * How long a pull request seen merged or closed stays on the list: every session open by then has checked it
 * and told it, and none that opens later has anything to tell of it.
 */
export const DONE_KEPT_MS = 24 * 60 * 60 * 1000

export type WatchedEntry = {
  /** Its title, as it was added or as a check last read it. */
  title: string
  /** How it ended, and when a check first saw it so (ms since the epoch); absent while it is open. */
  done?: { state: Exclude<PullState, "OPEN">; at: number }
  /** When it was added, ms since the epoch: a window that watched it before it was added again starts over. */
  since?: number
}
export type Watched = Record<string, WatchedEntry>

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

export function toWatched(value: unknown): Watched {
  if (!isObject(value)) return {}
  const watched: Watched = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) continue
    const done = isObject(entry.done) ? entry.done : undefined
    const state = done?.state === "MERGED" || done?.state === "CLOSED" ? done.state : undefined
    watched[key] = {
      title: typeof entry.title === "string" ? entry.title : "",
      ...(state !== undefined && typeof done?.at === "number" ? { done: { state, at: done.at } } : {}),
      ...(typeof entry.since === "number" ? { since: entry.since } : {}),
    }
  }

  return watched
}

/** `watched` without the pull requests seen merged or closed longer than `DONE_KEPT_MS` ago. */
export function dropDone(watched: Watched, now: number): Watched {
  return Object.fromEntries(Object.entries(watched).filter(([, entry]) => entry.done === undefined || now - entry.done.at <= DONE_KEPT_MS))
}

/** The key `watched` holds for `key` whatever its case, as GitHub tells names apart without it; undefined where none. */
export const findWatched = (watched: Watched, key: string) => Object.keys(watched).find(one => one.toLowerCase() === key.toLowerCase())
