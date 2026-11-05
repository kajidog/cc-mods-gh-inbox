// What a comment the log keeps says now: GitHub's Events API tells no edit or deletion, so the log pane
// asks for the comments of the page it shows, as it shows them, and nothing between.
import type { GhEvent, GhEventItem } from "../types"

import { snippet } from "./events"
import { object, text } from "./github"
import { BODY_KEPT } from "./history"

/** A line comment of a review, as GitHub answers it now. */
export type LatestComment = { url: string; body: string; editedAt: string | null }
/**
 * What GitHub answers now for a notice's comment or review: deleted, or its body and when it was last
 * edited, and a review's line comments (`isComplete` where all of them were answered).
 */
export type Latest =
  | { state: "deleted" }
  | { state: "found"; body: string; editedAt: string | null; comments?: LatestComment[]; isComplete?: boolean }

/** A part of a notice as it reads now: `note` where it changed since it was told. */
export type LatestItem = GhEventItem & { note?: "edited" | "deleted" }
/** What changed since a notice was told: its own comment deleted, edited (the newest edit), a line comment of it deleted. */
export type Change = { isDeleted: boolean; editedAt: string | null; isPartDeleted: boolean; items: LatestItem[] }

// A node id is letters, digits and `_-=`; the other ids a notice has (`run:1`, `merged:#3`, a commit's sha on a commit) are not asked for.
const NODE_ID = /^[A-Za-z0-9_=-]+$/
const ASKED_KINDS = new Set(["comment", "review"])
// Line comments of a review answered at most: a review with more is not told to have lost any.
const REVIEW_COMMENTS = 100
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

/** Asks what the comments `ids` (a page's, a few) say now, a review's line comments with it, in one GraphQL request. */
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
    `query=query { nodes(ids: [${list}]) { ... on Comment { body lastEditedAt } ... on PullRequestReview { comments(first: ${REVIEW_COMMENTS}) { totalCount nodes { url body lastEditedAt } } } } }`,
  ]
}

const nodesOf = (value: unknown) => {
  const list = object(value).nodes
  return Array.isArray(list) ? list.map(object) : []
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
    const json = object(node)
    const connection = object(json.comments)
    const comments = nodesOf(connection).map(comment => ({
      url: text(comment.url),
      body: text(comment.body),
      editedAt: text(comment.lastEditedAt) || null,
    }))
    latest.set(`${host}|${id}`, {
      state: "found",
      body: text(json.body),
      editedAt: text(json.lastEditedAt) || null,
      ...(json.comments === undefined ? {} : { comments, isComplete: comments.length === Number(connection.totalCount) }),
    })
  })

  return latest
}

// As the log keeps what was said: no HTML comment, which GitHub does not show.
const asKept = (body: string) => body.replace(/<!--[\s\S]*?-->/g, "").trim()

/**
 * How `keptItems` kept a body with `left` characters of `BODY_KEPT` still to spend: `whole`, `cut` (its start and
 * `…`, the rest spent), or `none` (no room was left for any of it).
 */
function howKept(body: string, left: number): "whole" | "cut" | "none" {
  if (left <= 1 && body === "") return "none"
  return body.length === left && body.endsWith("…") ? "cut" : "whole"
}

/**
 * Whether `now` says other than `kept`. The log keeps what was said when it was told, so an edit made before that
 * is no change; a body it cut is compared as far as it kept it, one it had no room for not at all.
 */
function differs(kept: string | undefined, now: string, how: "whole" | "cut" | "none"): boolean {
  if (kept === undefined || how === "none") return false
  const said = asKept(now)
  return how === "cut" ? !said.startsWith(kept.slice(0, -1)) : said !== kept
}

const newer = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)

/**
 * What changed of `event` since it was told, by what GitHub answers now: undefined where nothing did. A part
 * edited says what it says now; a line comment no longer among its review's is marked deleted, where all were answered.
 */
export function changeOf(event: Pick<GhEvent, "url" | "items" | "text">, latest: Latest | undefined): Change | undefined {
  if (latest === undefined) return undefined
  const kept: GhEventItem[] = Array.isArray(event.items) ? event.items : []
  if (latest.state === "deleted") return { isDeleted: true, editedAt: null, isPartDeleted: false, items: kept }

  let editedAt: string | null = null
  let isPartDeleted = false
  const comments = new Map((latest.comments ?? []).map(comment => [comment.url, comment]))
  // `keptItems` spends `BODY_KEPT` characters in order, cutting only the body that spends the last of them.
  let left = BODY_KEPT
  const items: LatestItem[] = kept.map(item => {
    const body = typeof item.body === "string" ? item.body : ""
    const how = howKept(body, left)
    left -= body.length
    if (item.url === event.url) {
      if (!differs(item.body, latest.body, how)) return item
      editedAt = newer(editedAt, latest.editedAt)
      return { ...item, body: asKept(latest.body), note: "edited" }
    }
    // A review's line comment, by its URL.
    if (item.path === undefined || latest.comments === undefined) return item
    const comment = comments.get(item.url ?? "")
    if (comment === undefined) {
      if (latest.isComplete !== true) return item
      isPartDeleted = true
      return { ...item, note: "deleted" }
    }
    if (!differs(item.body, comment.body, how)) return item
    editedAt = newer(editedAt, comment.editedAt)
    return { ...item, body: asKept(comment.body), note: "edited" }
  })
  // A notice that kept no words of its own (a review told with none, one kept before the log kept them) is
  // compared by its line, which ends in the start of what was said.
  const now = asKept(latest.body)
  if (!kept.some(item => item.url === event.url) && now !== "" && !event.text.includes(snippet(now))) {
    editedAt = newer(editedAt, latest.editedAt)
    items.unshift({ body: now, url: event.url, note: "edited" })
  }
  const isEdited = items.some(item => item.note === "edited")
  return isEdited || isPartDeleted ? { isDeleted: false, editedAt: isEdited ? (editedAt ?? "") : null, isPartDeleted, items } : undefined
}
