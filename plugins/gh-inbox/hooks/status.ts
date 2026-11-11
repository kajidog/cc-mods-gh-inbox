import type { GhPullStatus } from "../types"

import { displayName, type Nicknames, snippet } from "./events"
import type { Pull } from "./github"
import type { Language, Messages } from "./i18n"

/** How much of the latest comment the line under the prompt shows. */
const LATEST_LENGTH = 30

/**
 * What leads each part of where a pull request stands, the most pressing first: what fails and needs the author,
 * what still runs, what waits for someone else, that it can be merged now, what passed. The same in every language.
 */
export const MARKS = { failed: "✗", running: "◐", waiting: "○", ready: "●", passed: "✓" } as const

/** What parts the marks: each starts with its own, so a wide gap is enough. */
const MARK_GAP = "  "
/** What sets the newest comment apart from the marks, as the line under the prompt parts its repositories. */
const LATEST_GAP = " | "

/** The merge states in which GitHub would merge it now, every required review and check in. */
const READY: ReadonlySet<string> = new Set(["CLEAN", "HAS_HOOKS"])

/** Which the line under the prompt shows: the branch's pull request, or every registered repository. */
export const TRAY_VIEWS = ["pull", "repos"] as const
export type TrayView = (typeof TRAY_VIEWS)[number]
export const TRAY_VIEW_KEY = "trayView"

export const toTrayView = (value: unknown): TrayView => (value === "repos" ? "repos" : "pull")

/** Where the pull request stands now: its CI, its reviews, whether it merges cleanly, and who wrote last. */
export function pullStatus(pull: Pull, nicknames: Nicknames, language: Language = "en"): GhPullStatus {
  const checks = pull.checks
  // The newest of a comment, a review with words, a line comment: what someone said last.
  const said = [
    ...pull.comments.map(comment => ({ author: comment.author, body: comment.body, at: comment.at, url: comment.url })),
    ...pull.reviews.flatMap(review => [
      ...(review.body.trim() === "" ? [] : [{ author: review.author, body: review.body, at: review.at, url: review.url }]),
      ...review.comments.map(comment => ({ author: comment.author, body: comment.body, at: comment.at, url: comment.url })),
    ]),
  ].filter(one => one.at !== "" && snippet(one.body) !== "")
  const latest = said.reduce<(typeof said)[number] | undefined>((newest, one) => (newest === undefined || one.at > newest.at ? one : newest), undefined)

  return {
    ci:
      checks.length === 0
        ? null
        : {
            state: pull.ciState,
            total: checks.length,
            failed: checks.filter(check => check.isFailed).length,
            pending: checks.filter(check => check.isPending).length,
          },
    approvals: pull.verdicts.filter(state => state === "APPROVED").length,
    changesRequested: pull.verdicts.filter(state => state === "CHANGES_REQUESTED").length,
    reviewDecision: pull.reviewDecision,
    mergeable: pull.mergeable,
    mergeState: pull.mergeState,
    isDraft: pull.isDraft,
    autoMerge: pull.autoMerge !== null,
    latest:
      latest === undefined
        ? null
        : { author: latest.author, name: displayName(latest.author, nicknames, language), body: snippet(latest.body, LATEST_LENGTH), at: latest.at, url: latest.url },
  }
}

/** How CI stands as a mark leads it: failed, still running (none failed so far), or passed. */
export type CiStanding = "failed" | "running" | "passed"

/** CI as one part of the line: `✗ CI 1/3` (failed of all), `◐ CI 2/3` (done of all), `✓ CI`. */
export function ciMark(t: Messages, stands: CiStanding, count: number, total: number) {
  if (stands === "failed") return `${MARKS.failed} ${t.ciFailing(count, total)}`
  if (stands === "running") return `${MARKS.running} ${t.ciRunning(count, total)}`
  return `${MARKS.passed} ${t.ciPassed}`
}

/** Whether GitHub would merge the pull request now, every required review and check in. */
export const isReady = (status: Pick<GhPullStatus, "isDraft" | "mergeState">) => status.isDraft !== true && READY.has(status.mergeState ?? "")

/**
 * Where an open pull request stands, a mark leading each part, the most pressing first: what fails (✗), what runs (◐),
 * what waits (○), that it can be merged now (●), what passed (✓). What a later part would only say again is left out.
 */
export function statusMarks(t: Messages, status: GhPullStatus): string[] {
  const { ci } = status
  const stands: CiStanding | null =
    ci === null ? null : ci.failed > 0 ? "failed" : ci.pending > 0 || ci.state === "PENDING" || ci.state === "EXPECTED" ? "running" : "passed"
  const ready = isReady(status)
  const failed = [
    ...(status.mergeable === "CONFLICTING" || status.mergeState === "DIRTY" ? [t.conflicting] : []),
    ...(ci !== null && stands === "failed" ? [t.ciFailing(ci.failed, ci.total)] : []),
    ...(status.changesRequested > 0 ? [t.changeRequests(status.changesRequested)] : []),
    ...(status.mergeState === "BEHIND" ? [t.behind] : []),
  ]
  const running = ci !== null && stands === "running" ? [t.ciRunning(ci.total - ci.pending, ci.total)] : []
  const waiting = [
    // Approved by some but not by as many as the base asks for: still waiting.
    ...(status.reviewDecision === "REVIEW_REQUIRED" ? [t.reviewRequired] : []),
    ...(status.autoMerge === true ? [t.autoMergeOn] : []),
  ]
  // Blocked by what no other part tells (a conversation to resolve, a signature): said so, rather than nothing.
  if (status.mergeState === "BLOCKED" && failed.length + running.length + waiting.length === 0) waiting.push(t.blocked)
  const passed = [
    // That it can be merged says CI did not fail: CI's own mark would say it again.
    ...(stands === "passed" && !ready ? [t.ciPassed] : []),
    ...(status.approvals > 0 ? [t.approvals(status.approvals)] : []),
  ]

  return [
    ...failed.map(part => `${MARKS.failed} ${part}`),
    ...running.map(part => `${MARKS.running} ${part}`),
    ...waiting.map(part => `${MARKS.waiting} ${part}`),
    ...(ready ? [`${MARKS.ready} ${t.readyToMerge}`] : []),
    ...passed.map(part => `${MARKS.passed} ${part}`),
  ]
}

/** Where the pull request stands, in parts: its number (with a draft's or an ended one's state), its marks, the newest comment. */
export type StatusParts = { head: string; marks: string[]; latest: string | undefined }

/** Where the pull request stands, in parts; `ago` telling how long ago a time was. An ended one says so alone. */
export function statusParts(t: Messages, number: number, state: string | null, status: GhPullStatus | null | undefined, ago: (at: string) => string | undefined): StatusParts {
  if (state !== null && state !== "OPEN") return { head: `#${number}${t.paren(t.pullState(state))}`, marks: [], latest: undefined }
  const head = `#${number}${status?.isDraft === true ? t.paren(t.draft) : ""}`
  if (status === null || status === undefined) return { head, marks: [], latest: undefined }
  const said = status.latest
  const latest = said === null ? undefined : t.latestComment(t.who(said.name), said.body, ago(said.at))

  return { head, marks: statusMarks(t, status), latest }
}

/** The parts as one line: the number (`withHead`), the marks, and after a bar the newest comment. */
export function statusText(parts: StatusParts, withHead = true) {
  const marks = [...(withHead ? [parts.head] : []), ...parts.marks].join(MARK_GAP)
  if (parts.latest === undefined) return marks
  return marks === "" ? parts.latest : `${marks}${LATEST_GAP}${parts.latest}`
}
