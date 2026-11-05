// What a comment the log keeps says now: GitHub's Events API tells no edit or deletion, so the log pane
// asks for the comments of the page it shows, as it shows them, and nothing between.
import type { GhEvent, GhEventItem } from "../types"

import { object, text } from "./github"

/** What a comment, a review or a line comment says now; `same` where it is as it was told. */
export type Latest = { state: "edited"; body: string; editedAt: string } | { state: "deleted" } | { state: "same" }

// A node id is letters, digits and `_-=`; the other ids a notice has (`run:1`, `merged:#3`, a commit's sha on a commit) are not asked for.
const NODE_ID = /^[A-Za-z0-9_=-]+$/
const ASKED_KINDS = new Set(["comment", "review"])
const hostOf = (url: string) => /^https?:\/\/([^/]+)\//.exec(url)?.[1] ?? ""

/** Where `latestKey` files what `event`'s comment says now; undefined for a notice that is no comment. */
export function latestKey(event: Pick<GhEvent, "id" | "kind" | "url">): string | undefined {
  const host = hostOf(event.url)
  return ASKED_KINDS.has(event.kind) && NODE_ID.test(event.id) && host !== "" ? `${host}|${event.id}` : undefined
}

/** The keys of `events`, by host, that `known` holds nothing for yet. */
export function latestWanted(events: readonly GhEvent[], known: ReadonlySet<string>): Map<string, string[]> {
  const wanted = new Map<string, string[]>()
  for (const event of events) {
    const key = latestKey(event)
    if (key === undefined || known.has(key)) continue
    const host = key.slice(0, key.indexOf("|"))
    const ids = wanted.get(host) ?? []
    if (!ids.includes(event.id)) wanted.set(host, [...ids, event.id])
  }
  return wanted
}

/** Asks what the comments `ids` (a page's, a few) say now, in one GraphQL request: one point. */
export function latestArgv(host: string, ids: readonly string[]): string[] {
  // Node ids are written into the query as they are, `NODE_ID` holding them to what needs no escaping.
  const list = ids
    .filter(id => NODE_ID.test(id))
    .map(id => `"${id}"`)
    .join(", ")
  return [
    "gh",
    "api",
    ...(host === "github.com" ? [] : ["--hostname", host]),
    "graphql",
    "-f",
    `query=query { nodes(ids: [${list}]) { ... on Comment { body lastEditedAt } } }`,
  ]
}

/**
 * Reads `latestArgv`'s answer, by `host|id`. A comment GitHub no longer knows is `deleted`; one it did not
 * answer for (a request that failed, a repository no longer readable) is left out, to be asked again.
 */
export function parseLatest(host: string, ids: readonly string[], answer: string): Map<string, Latest> {
  const json = object(JSON.parse(answer))
  const found = Array.isArray(object(json.data).nodes) ? (object(json.data).nodes as unknown[]) : []
  const gone = new Set(
    (Array.isArray(json.errors) ? json.errors.map(object) : []).flatMap(error => {
      const path = Array.isArray(error.path) ? error.path : []
      return error.type === "NOT_FOUND" && path[0] === "nodes" && typeof path[1] === "number" ? [path[1]] : []
    }),
  )
  const latest = new Map<string, Latest>()
  ids.forEach((id, index) => {
    const node = found[index]
    if (node === null || node === undefined) {
      if (gone.has(index)) latest.set(`${host}|${id}`, { state: "deleted" })
      return
    }
    const editedAt = text(object(node).lastEditedAt)
    latest.set(`${host}|${id}`, editedAt === "" ? { state: "same" } : { state: "edited", body: text(object(node).body), editedAt })
  })

  return latest
}

/** `items` with what `event`'s own comment says now in place of what it said, where it was edited. */
export function withLatest(event: Pick<GhEvent, "url">, items: readonly GhEventItem[], latest: Latest | undefined): GhEventItem[] {
  if (latest?.state !== "edited") return [...items]
  // As the log keeps what was said: no HTML comment, which GitHub does not show.
  const body = latest.body.replace(/<!--[\s\S]*?-->/g, "").trim()
  const at = items.findIndex(item => item.url === event.url)
  if (at === -1) return body === "" ? [...items] : [{ body, url: event.url }, ...items]
  return items.map((item, index) => (index === at ? { ...item, body } : item))
}
