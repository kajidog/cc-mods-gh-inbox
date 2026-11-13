// How the pane of `/inbox pr <PR>` draws a pull request to read: the color each card and mark is drawn in, and how
// much of a long body a folded card shows.

import type { GhPickCard, GhPickItem, GhPrDetail } from "../types"

import { MARKS } from "./status"

/** Lines a folded card shows of what was written, at most. */
export const CARD_LINES = 6
/** Characters a folded card shows of what was written, at most: a few long lines wrap to many. */
export const CARD_CHARS = 500

/** A theme key of the person's theme, as a Box's border and a Text take it. */
export type ThemeColor = "error" | "warning" | "success" | "permission" | "merged" | "inactive" | "subtle" | "suggestion"

/** The color of a part of where a pull request stands, by the mark that leads it; undefined for the text's own. */
export function markColor(part: string): ThemeColor | undefined {
  switch (part.charAt(0)) {
    case MARKS.failed:
      return "error"
    case MARKS.running:
      return "warning"
    case MARKS.waiting:
      return "permission"
    case MARKS.ready:
    case MARKS.passed:
      return "success"
    default:
      return undefined
  }
}

/** The marks from the most pressing to the least, as `byPressing` weighs them. */
const PRESSING: readonly string[] = [MARKS.failed, MARKS.ready, MARKS.running, MARKS.waiting, MARKS.passed]

/**
 * The color of the card that says where a pull request stands: merged, closed or a draft by that alone; an open one by
 * the most pressing of its parts (what fails, that it can be merged now, what runs, what waits, what passed).
 */
export function standingColor(detail: Pick<Extract<GhPrDetail, { stage: "pull" }>, "state" | "status">, marks: readonly string[]): ThemeColor {
  if (detail.state === "MERGED") return "merged"
  if (detail.state === "CLOSED" || detail.status.isDraft === true) return "inactive"
  const first = PRESSING.find(mark => marks.some(part => part.startsWith(`${mark} `)))
  return first === undefined ? "subtle" : (markColor(first) ?? "subtle")
}

/** The color of an item's card: a review by what it says, a thread by whether it is still open, CI by how it went. */
export function cardColor(card: GhPickCard | undefined): ThemeColor {
  switch (card?.kind) {
    case "ci":
      return card.state === "failed" ? "error" : card.state === "running" ? "warning" : "success"
    case "review":
      return card.state === "APPROVED" ? "success" : card.state === "CHANGES_REQUESTED" ? "error" : card.state === "DISMISSED" ? "inactive" : "subtle"
    case "thread":
      return card.isResolved === true || card.isOutdated === true ? "inactive" : "warning"
    default:
      return "subtle"
  }
}

// A line that opens or closes a fenced code block, and the fence it is.
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * `body` as a folded card shows it: its first `lines` lines, `chars` characters at most, a code block it cut through
 * closed again so what follows does not read as code; `left` counts the lines it held back, 0 where it shows all.
 */
export function cutBody(body: string, lines = CARD_LINES, chars = CARD_CHARS): { shown: string; left: number } {
  const all = body.split("\n")
  const kept: string[] = []
  let used = 0
  for (const line of all) {
    if (kept.length >= lines || (kept.length > 0 && used + line.length > chars)) break
    kept.push(line.length > chars ? `${line.slice(0, chars - 1)}…` : line)
    used += line.length
  }
  const left = all.length - kept.length
  if (left === 0) return { shown: body, left: 0 }
  let open: string | undefined
  for (const line of kept) {
    const fence = FENCE.exec(line)?.[1]
    if (fence === undefined) continue
    if (open === undefined) open = fence
    else if (fence.charAt(0) === open.charAt(0) && fence.length >= open.length) open = undefined
  }

  return { shown: open === undefined ? kept.join("\n") : [...kept, open].join("\n"), left }
}

/** The cards of the conversation, in the order the list holds them: each review with its threads under it, each comment, each thread with no review listed. */
export type Conversation = Array<{ item: GhPickItem; threads: GhPickItem[] }>

/** The items of the conversation: those neither CI nor the description, a thread under the review it came with. */
export function conversationOf(items: readonly GhPickItem[]): Conversation {
  const shown = items.filter(item => item.card?.kind !== "ci" && item.card?.kind !== "description")
  const ids = new Set(shown.map(item => item.id))
  return shown
    .filter(item => item.parent === undefined || !ids.has(item.parent))
    .map(item => ({ item, threads: shown.filter(one => one.parent === item.id) }))
}
