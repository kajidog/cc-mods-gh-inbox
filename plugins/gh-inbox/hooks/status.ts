import type { GhPullStatus } from "../types"

import { displayName, type Nicknames, snippet } from "./events"
import type { Pull } from "./github"
import type { Language, Messages } from "./i18n"

/** How much of the latest comment the line under the prompt shows. */
const LATEST_LENGTH = 40

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
    latest:
      latest === undefined
        ? null
        : { author: latest.author, name: displayName(latest.author, nicknames, language), body: snippet(latest.body, LATEST_LENGTH), at: latest.at, url: latest.url },
  }
}

/** The parts of the line about the pull request, `ago` telling how long ago a time was; the line joins them. */
export function statusParts(t: Messages, number: number, state: string | null, status: GhPullStatus | null | undefined, ago: (at: string) => string | undefined) {
  if (state !== null && state !== "OPEN") return [`#${number}${t.paren(t.pullState(state))}`]
  const parts = [`#${number}`]
  if (status === null || status === undefined) return parts
  const { ci } = status
  if (ci !== null) {
    if (ci.failed > 0) parts.push(t.ciFailing(ci.failed, ci.total))
    else if (ci.pending > 0 || ci.state === "PENDING" || ci.state === "EXPECTED") parts.push(t.ciRunning(ci.total - ci.pending, ci.total))
    else parts.push(t.ciPassed)
  }
  if (status.approvals > 0) parts.push(t.approvals(status.approvals))
  if (status.changesRequested > 0) parts.push(t.changeRequests(status.changesRequested))
  if (status.approvals === 0 && status.changesRequested === 0 && status.reviewDecision === "REVIEW_REQUIRED") parts.push(t.reviewRequired)
  if (status.mergeable === "CONFLICTING") parts.push(t.conflicting)
  if (status.latest !== null) {
    const when = ago(status.latest.at)
    parts.push(`${t.latestComment(t.who(status.latest.name), status.latest.body)}${when === undefined ? "" : ` ${when}`}`)
  }

  return parts
}
