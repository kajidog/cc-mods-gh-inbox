import type { GhPullStatus, GhReviewer } from "../types"

import { displayName, type Nicknames, snippet } from "./events"
import type { Pull, Standing } from "./github"
import type { Language, Messages } from "./i18n"

/** How much of the latest comment the line under the prompt shows. */
const LATEST_LENGTH = 30
/** Reviewers named in a part at most; past it, the last named gives way to how many more there are. */
const NAMES_SHOWN = 3

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

/** Where a pull request stands now, who wrote last left out: its CI, its reviews and who gave or owes them, whether it merges cleanly. */
export function standingStatus(pull: Standing, nicknames: Nicknames, language: Language = "en"): GhPullStatus {
  const { checks } = pull
  const person = (login: string): GhReviewer => ({ name: displayName(login, nicknames, language), isTeam: false })
  const by = (state: string) => pull.verdicts.filter(verdict => verdict.state === state)
  // Those GitHub names no one for (a deleted account, an answer kept from before it was asked for) are counted, not named.
  const named = (state: string) => by(state).flatMap(verdict => (verdict.author === null ? [] : [person(verdict.author)]))

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
    approvals: by("APPROVED").length,
    changesRequested: by("CHANGES_REQUESTED").length,
    approvedBy: named("APPROVED"),
    changesRequestedBy: named("CHANGES_REQUESTED"),
    awaiting: pull.requested.map(asked => (asked.isTeam ? { name: asked.login, isTeam: true } : person(asked.login))),
    reviewDecision: pull.reviewDecision,
    mergeable: pull.mergeable,
    mergeState: pull.mergeState,
    isDraft: pull.isDraft,
    autoMerge: pull.autoMerge !== null,
    latest: null,
  }
}

/** Where the pull request stands now: its CI, its reviews, whether it merges cleanly, and who wrote last. */
export function pullStatus(pull: Pull, nicknames: Nicknames, language: Language = "en"): GhPullStatus {
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
    ...standingStatus(pull, nicknames, language),
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

/** `reviewers` as a part names them: people as the mod calls them, teams after `@`; the first few, then how many more. */
export function reviewerNames(t: Messages, reviewers: readonly GhReviewer[]) {
  const names = reviewers.map(one => (one.isTeam ? `@${one.name}` : t.who(one.name)))
  if (names.length <= NAMES_SHOWN) return names.join(t.listSeparator)
  return `${names.slice(0, NAMES_SHOWN - 1).join(t.listSeparator)}${t.morePeople(names.length - (NAMES_SHOWN - 1))}`
}

/**
 * How `statusMarks` tells the reviews. `withNames`: who gave them and who is still asked (the line under the prompt
 * counts them alone). `awaiting`: which review not given yet it says is awaited: `any` (one the base requires, or one
 * asked of someone who has not answered), `required` (the base's alone: what holds a merge back), `none` (a list of
 * those the person is asked to review, where it goes without saying).
 */
export type MarksOptions = { withNames?: boolean; awaiting?: "any" | "required" | "none" }

/**
 * Where an open pull request stands, a mark leading each part, the most pressing first: what fails (✗), what runs (◐),
 * what waits (○), that it can be merged now (●), what passed (✓). What a later part would only say again is left out.
 * The reviews are told as `options` say; a status kept from before the reviewers were asked for counts them either way.
 */
export function statusMarks(t: Messages, status: GhPullStatus, options: MarksOptions = {}): string[] {
  const { withNames = false, awaiting: awaited = "any" } = options
  const { ci } = status
  // Named only where every one of them is known; else counted, as the line under the prompt counts them.
  const named = (reviewers: readonly GhReviewer[] | undefined, count: number) =>
    withNames && reviewers !== undefined && reviewers.length > 0 && reviewers.length === count ? reviewerNames(t, reviewers) : undefined
  const approvedBy = named(status.approvedBy, status.approvals)
  const changesRequestedBy = named(status.changesRequestedBy, status.changesRequested)
  const awaiting = awaited === "any" ? (status.awaiting ?? []) : []
  const awaitingFrom = named(awaiting, awaiting.length)
  // Asked of someone who has not answered, or asked for by the base: waiting either way.
  const isRequired = status.reviewDecision === "REVIEW_REQUIRED"
  const isSaid = awaited !== "none" && (isRequired || awaiting.length > 0)
  const stands: CiStanding | null =
    ci === null ? null : ci.failed > 0 ? "failed" : ci.pending > 0 || ci.state === "PENDING" || ci.state === "EXPECTED" ? "running" : "passed"
  const ready = isReady(status)
  const failed = [
    ...(status.mergeable === "CONFLICTING" || status.mergeState === "DIRTY" ? [t.conflicting] : []),
    ...(ci !== null && stands === "failed" ? [t.ciFailing(ci.failed, ci.total)] : []),
    ...(status.changesRequested > 0 ? [changesRequestedBy === undefined ? t.changeRequests(status.changesRequested) : t.changesRequestedBy(changesRequestedBy)] : []),
    ...(status.mergeState === "BEHIND" ? [t.behind] : []),
  ]
  const running = ci !== null && stands === "running" ? [t.ciRunning(ci.total - ci.pending, ci.total)] : []
  const waiting = [
    // Approved by some but not by as many as the base asks for, or asked of someone who has not answered: still waiting.
    ...(isSaid ? [awaitingFrom === undefined ? t.reviewRequired : t.awaitingFrom(awaitingFrom)] : []),
    ...(status.autoMerge === true ? [t.autoMergeOn] : []),
  ]
  // Blocked by what no other part tells (a conversation to resolve, a signature): said so, rather than nothing. A review
  // asked of someone that the base does not require does not tell why.
  if (status.mergeState === "BLOCKED" && failed.length + running.length === 0 && !isRequired && status.autoMerge !== true) waiting.push(t.blocked)
  const passed = [
    // That it can be merged says CI did not fail: CI's own mark would say it again.
    ...(stands === "passed" && !ready ? [t.ciPassed] : []),
    ...(status.approvals > 0 ? [approvedBy === undefined ? t.approvals(status.approvals) : t.approvedBy(approvedBy)] : []),
  ]

  return [
    ...failed.map(part => `${MARKS.failed} ${part}`),
    ...running.map(part => `${MARKS.running} ${part}`),
    ...waiting.map(part => `${MARKS.waiting} ${part}`),
    ...(ready ? [`${MARKS.ready} ${t.readyToMerge}`] : []),
    ...passed.map(part => `${MARKS.passed} ${part}`),
  ]
}

/** The marks from the most pressing to the least, as `statusMarks` leads its parts with them. */
const PRESSING: readonly string[] = [MARKS.failed, MARKS.ready, MARKS.running, MARKS.waiting, MARKS.passed]

/**
 * `list` with what asks most of its author first: by the most pressing of its marks (what fails, then what can be
 * merged now, then what runs, what waits, what passed), drafts last; alike, the one updated last first.
 */
export function byPressing<T extends { status: GhPullStatus; updatedAt: string }>(t: Messages, list: readonly T[]): T[] {
  const rank = (one: T) => {
    if (one.status.isDraft === true) return PRESSING.length + 1
    const at = PRESSING.indexOf(statusMarks(t, one.status)[0]?.charAt(0) ?? "")
    return at === -1 ? PRESSING.length : at
  }
  return [...list].sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
}

/** Where the pull request stands, in parts: its number (with a draft's or an ended one's state), its marks, the newest comment. */
export type StatusParts = { head: string; marks: string[]; latest: string | undefined }

/**
 * Where the pull request stands, in parts; `ago` telling how long ago a time was, `withNames` naming the reviewers. An
 * ended one says so alone.
 */
export function statusParts(
  t: Messages,
  number: number,
  state: string | null,
  status: GhPullStatus | null | undefined,
  ago: (at: string) => string | undefined,
  withNames = false,
): StatusParts {
  if (state !== null && state !== "OPEN") return { head: `#${number}${t.paren(t.pullState(state))}`, marks: [], latest: undefined }
  const head = `#${number}${status?.isDraft === true ? t.paren(t.draft) : ""}`
  if (status === null || status === undefined) return { head, marks: [], latest: undefined }
  const said = status.latest
  const latest = said === null ? undefined : t.latestComment(t.who(said.name), said.body, ago(said.at))

  return { head, marks: statusMarks(t, status, { withNames }), latest }
}

/** The parts as one line: the number (`withHead`), the marks, and after a bar the newest comment. */
export function statusText(parts: StatusParts, withHead = true) {
  const marks = [...(withHead ? [parts.head] : []), ...parts.marks].join(MARK_GAP)
  if (parts.latest === undefined) return marks
  return marks === "" ? parts.latest : `${marks}${LATEST_GAP}${parts.latest}`
}
