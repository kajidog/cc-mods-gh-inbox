import type { GhEvent } from "../types"

import { type Commit, type Pull, pullName, type ReviewComment } from "./github"

export type Nicknames = Record<string, string>
export type EventOptions = { nicknames: Nicknames; notifySelf: boolean }

const SNIPPET_LENGTH = 80
const TITLES_SHOWN = 3
// Seen ids kept per pull request; older ones fall off once the page no longer lists them.
export const SEEN_LIMIT = 1000

export const MERGED_ID = "state:merged"
export const CLOSED_ID = "state:closed"

// Control characters (an escape sequence among them) and bidirectional overrides:
// what anyone can write into a comment must not drive the terminal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g

/** `text` with no control characters, safe to show as one line. */
export const plain = (text: string) => text.replace(UNSAFE, "")

/** The first readable line of a Markdown body, cut to a toast's length. */
export function snippet(body: string, length = SNIPPET_LENGTH): string {
  const line =
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map(one =>
        one
          .replace(/^\s*(?:#+|>+|[-*+]|\d+\.)\s+/, "")
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[*_`|]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(one => one !== "") ?? ""

  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

/** `path:line` of a line comment. */
const place = (comment: Pick<ReviewComment, "path" | "line">) => `${comment.path}${comment.line === null ? "" : `:${comment.line}`}`

export const displayName = (login: string | null, nicknames: Nicknames) =>
  login === null ? "誰か" : (nicknames[login] ?? login)

/** Every id the pull request shows now, as `newEvents` records them. */
export function pullIds(pull: Pull): string[] {
  return [
    ...pull.comments.map(comment => comment.id),
    ...pull.reviews.flatMap(review => [review.id, ...review.comments.map(comment => comment.id)]),
    ...pull.commits.map(commit => commit.oid),
    ...pull.checks.filter(check => check.isFailed).map(check => check.id),
    ...(pull.state === "MERGED" ? [MERGED_ID] : pull.state === "CLOSED" ? [CLOSED_ID] : []),
  ]
}

/**
 * The notices for what `seen` does not hold yet, oldest first. Without `seen`
 * (the first look at a pull request) nothing is notified: all of it is old news.
 */
export function newEvents(pull: Pull, seen: ReadonlySet<string> | undefined, options: EventOptions): GhEvent[] {
  if (seen === undefined) return []
  const name = pullName(pull.ref)
  const who = (login: string | null) => `${displayName(login, options.nicknames)}さん`
  const isMuted = (login: string | null) => !options.notifySelf && login !== null && login === pull.viewer
  const events: GhEvent[] = []

  for (const comment of pull.comments) {
    if (seen.has(comment.id) || isMuted(comment.author)) continue
    events.push({
      id: comment.id,
      kind: "comment",
      pull: name,
      author: comment.author,
      at: comment.at,
      text: `${who(comment.author)}がコメントしました。${snippet(comment.body)}`,
      url: comment.url,
      items: [{ body: comment.body, url: comment.url }],
    })
  }

  for (const review of pull.reviews) {
    if (seen.has(review.id) || isMuted(review.author)) {
      // A reply can join a review told already, or one of mine: its new comments are told one by one.
      for (const comment of review.comments) {
        if (seen.has(comment.id) || isMuted(comment.author)) continue
        events.push({
          id: comment.id,
          kind: "comment",
          pull: name,
          author: comment.author,
          at: comment.at,
          text: `${who(comment.author)}がコメントしました。${place(comment)} ${snippet(comment.body)}`.trimEnd(),
          url: comment.url,
          items: [{ body: comment.body, path: comment.path, line: comment.line, hunk: comment.hunk, url: comment.url }],
        })
      }
      continue
    }
    if (isMuted(review.author)) continue
    const count = review.comments.length
    const items = [
      ...(review.body.trim() === "" ? [] : [{ body: review.body, url: review.url }]),
      ...review.comments.map(comment => ({
        body: comment.body,
        path: comment.path,
        line: comment.line,
        hunk: comment.hunk,
        url: comment.url,
      })),
    ]
    const summary = snippet(review.body)
    const first = review.comments[0]
    let text: string
    if (review.state === "APPROVED") {
      text = `${who(review.author)}が承認しました。${summary}`
    } else if (review.state === "CHANGES_REQUESTED") {
      text = `${who(review.author)}が変更を依頼しました。${count > 0 ? `指摘${count}件 ` : ""}${summary}`
    } else if (review.state === "COMMENTED") {
      if (summary !== "") text = `${who(review.author)}がレビューしました。${count > 0 ? `指摘${count}件 ` : ""}${summary}`
      else if (count === 1 && first !== undefined)
        text = `${who(review.author)}がコメントしました。${place(first)} ${snippet(first.body)}`
      else if (count > 1) text = `${who(review.author)}が${count}件コメントしました。`
      else continue
    } else {
      // PENDING is a draft not yet sent; DISMISSED is a review taken back.
      continue
    }
    events.push({
      id: review.id,
      kind: "review",
      pull: name,
      author: review.author,
      at: review.at,
      text: text.trimEnd(),
      url: review.url,
      items,
    })
  }

  const pushed = new Map<string, Commit[]>()
  for (const commit of pull.commits) {
    if (seen.has(commit.oid) || isMuted(commit.author)) continue
    const key = commit.author ?? ""
    pushed.set(key, [...(pushed.get(key) ?? []), commit])
  }
  for (const commits of pushed.values()) {
    const last = commits.at(-1)
    if (last === undefined) continue
    const titles = commits.slice(0, TITLES_SHOWN).map(commit => commit.title)
    const more = commits.length > TITLES_SHOWN ? ` ほか${commits.length - TITLES_SHOWN}件` : ""
    const additions = commits.reduce((sum, commit) => sum + commit.additions, 0)
    const deletions = commits.reduce((sum, commit) => sum + commit.deletions, 0)
    events.push({
      id: last.oid,
      kind: "commit",
      pull: name,
      author: last.author,
      at: last.at,
      text: `${who(last.author)}がコミットしました。${titles.join(" / ")}${more} (+${additions} −${deletions})`,
      url: last.url,
      items: commits.map(commit => ({ body: commit.title, url: commit.url })),
    })
  }

  const stamp = events.reduce((latest, event) => (event.at > latest ? event.at : latest), "")
  for (const check of pull.checks) {
    if (!check.isFailed || seen.has(check.id)) continue
    events.push({
      id: check.id,
      kind: "ci",
      pull: name,
      author: null,
      at: stamp,
      text: `${check.name}のCIが失敗しました。${check.failedStep ?? ""}`.trimEnd(),
      url: check.url,
      items: check.failedStep === null ? [] : [{ body: check.failedStep, url: check.url }],
    })
  }

  if (pull.state === "MERGED" && !seen.has(MERGED_ID)) {
    events.push({
      id: MERGED_ID,
      kind: "merge",
      pull: name,
      author: pull.mergedBy,
      at: pull.closedAt ?? stamp,
      text: `#${pull.ref.number} がマージされました。`,
      url: pull.url,
      items: [],
    })
  } else if (pull.state === "CLOSED" && !seen.has(CLOSED_ID) && !isMuted(pull.closedBy)) {
    events.push({
      id: CLOSED_ID,
      kind: "close",
      pull: name,
      author: pull.closedBy,
      at: pull.closedAt ?? stamp,
      text: `#${pull.ref.number} がクローズされました。`,
      url: pull.url,
      items: [],
    })
  }

  // ISO times sort as text, and the sort is stable; an event with no time goes last.
  const order = (event: GhEvent) => event.at || "￿"
  return events.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0))
}

/**
 * `seen` with `ids` added, the newest `SEEN_LIMIT` kept. Every one of `ids`
 * stays, however many: one that GitHub still lists and fell off would be told again.
 */
export function mergeSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const fresh = new Set(ids)
  const kept = seen.filter(id => !fresh.has(id))
  return [...kept, ...fresh].slice(-Math.max(SEEN_LIMIT, fresh.size))
}
