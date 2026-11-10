// What Claude reads of a pull request's CI: the commit it passed on, or what failed and how to look into it.

import type { GhPickItem } from "../types"

import { fence } from "./events"
import { type Check, type PullRef, pullName } from "./github"
import type { Messages } from "./i18n"
import { ciMark } from "./status"

/** Checks named at most in the line of those that did not fail. */
const NAMES_LISTED = 30
/** Characters kept of what a check says of itself, and of an annotation's message. */
const SAID_LENGTH = 500
/** The id a pick item of CI has, before how CI stands. */
export const CI_ITEM_PREFIX = "ci:"

/** A commit's checks: `state` is GitHub's rollup of every one of them, `total` counts those not listed too. */
export type Ci = { oid: string; state: string | null; checks: readonly Check[]; total: number }

function groups(checks: readonly Check[]) {
  const failed = checks.filter(check => check.isFailed)
  const running = checks.filter(check => !check.isFailed && check.isPending)
  const passed = checks.filter(check => !check.isFailed && !check.isPending && check.conclusion === "SUCCESS")
  const other = checks.filter(check => !check.isFailed && !check.isPending && check.conclusion !== "SUCCESS")
  return { failed, running, passed, other }
}

/**
 * Whether the commit's CI failed, still runs or is done; null with no checks. Where the list was cut
 * short, it is done only when GitHub's rollup of every check says it passed: one not listed may still
 * run, or have failed.
 */
function standing(ci: Ci): "failed" | "running" | "done" | null {
  if (ci.oid === "" || ci.checks.length === 0) return null
  const { failed, running } = groups(ci.checks)
  if (failed.length > 0) return "failed"
  if (running.length > 0 || (ci.total > ci.checks.length && ci.state !== "SUCCESS")) return "running"
  return "done"
}

/**
 * How the commit's CI stands, as a key that changes with it: the checks that failed, or whether
 * the rest still run; null with no checks to tell of.
 */
export function ciKey(ci: Ci): string | null {
  const stands = standing(ci)
  if (stands === null) return null
  if (stands !== "failed") return `${ci.oid}:${stands}`
  return `${ci.oid}:failed:${groups(ci.checks).failed.map(check => check.id).sort().join(",")}`
}

/** Whether CI standing at `key` is a result: something failed, or every check is done. Not while the rest run with none failed. */
export const isResult = (key: string) => !key.endsWith(":running")

/** `-R owner/repo`, the host named where it is not github.com. */
const repoFlag = (ref: PullRef) => `-R ${ref.host === "github.com" ? "" : `${ref.host}/`}${ref.owner}/${ref.repo}`

/** The command that reads the log of a GitHub Actions job's failed steps, or of its run's where the job is not known. */
export function logCommand(ref: PullRef, actions: NonNullable<Check["actions"]>) {
  const which = actions.jobId === null ? String(actions.runId) : `--job ${actions.jobId}`
  return `gh run view ${which} --log-failed ${repoFlag(ref)}`
}

const cut = (said: string) => (said.length > SAID_LENGTH ? `${said.slice(0, SAID_LENGTH - 1)}…` : said)

function names(t: Messages, checks: readonly Check[], withHow: boolean) {
  const shown = checks.slice(0, NAMES_LISTED).map(check => `${check.name}${withHow && check.conclusion !== "" ? t.paren(t.conclusion(check.conclusion)) : ""}`)
  return `${shown.join(t.listSeparator)}${checks.length > NAMES_LISTED ? t.more(checks.length - NAMES_LISTED) : ""}`
}

/** What one failed check says: its name, its failed step, where it is, how to read its log, and what it reported, fenced. */
function failedLines(t: Messages, ref: PullRef, check: Check) {
  const how = check.conclusion === "" || check.conclusion === "FAILURE" ? "" : t.paren(t.conclusion(check.conclusion))
  const said = [
    ...(check.summary.trim() === "" ? [] : [cut(check.summary.trim())]),
    ...check.annotations.map(one => {
      const place = `${one.path}${one.line === null ? "" : `:${one.line}`}`
      return `${place} ${one.level.toLowerCase()}${one.title.trim() === "" ? "" : ` ${one.title.trim()}`}: ${cut(one.message.trim())}`
    }),
  ].join("\n")
  const left = check.annotationCount - check.annotations.length

  return [
    `${t.ciGroups.failed}: ${check.name}${check.failedStep === null ? "" : t.ciStep(check.failedStep)}${how}`,
    ...(check.url === "" ? [] : [check.url]),
    ...(check.actions === null ? [] : [t.ciLog(logCommand(ref, check.actions))]),
    ...(said === "" ? [] : [`${fence(said)}text`, said, fence(said)]),
    ...(check.annotations.length > 0 && left > 0 ? [t.annotationsLeftOut(left)] : []),
  ]
}

/**
 * What Claude reads of CI: the commit, how it went in a line, then each failed check with
 * where to look into it, and the names of the rest. What CI reported in its own words (a
 * status's description, a check run's title and annotations) is fenced.
 */
export function ciContext(t: Messages, ref: PullRef, ci: Ci): string {
  const { failed, running, passed, other } = groups(ci.checks)
  // None listed fails or runs, but the list is cut short and GitHub's rollup does not say all passed.
  const isUnsure = standing(ci) === "running" && running.length === 0
  const summary = isUnsure ? t.ciSummaryCut(ci.checks.length, ci.total, t.conclusion(ci.state ?? "UNKNOWN")) : t.ciSummary(failed.length, running.length, ci.total)
  const lines = [t.ciHeading(ci.oid), summary]
  for (const check of failed) lines.push("", ...failedLines(t, ref, check))
  const rest = [
    ...(running.length === 0 ? [] : [`${t.ciGroup(t.ciGroups.running, running.length)}: ${names(t, running, false)}`]),
    ...(passed.length === 0 ? [] : [`${t.ciGroup(t.ciGroups.passed, passed.length)}: ${names(t, passed, false)}`]),
    ...(other.length === 0 ? [] : [`${t.ciGroup(t.ciGroups.other, other.length)}: ${names(t, other, true)}`]),
    ...(ci.total > ci.checks.length ? [t.checksLeftOut(ci.total - ci.checks.length)] : []),
  ]
  if (rest.length > 0) lines.push("", ...rest)

  return lines.join("\n")
}

/** The pick pane's item of the head commit's CI, its id telling how CI stood; null with no checks. */
export function ciItem(t: Messages, ref: PullRef, ci: Ci): GhPickItem | null {
  const key = ciKey(ci)
  const stands = standing(ci)
  if (key === null || stands === null) return null
  const { failed, running } = groups(ci.checks)
  const status = ciMark(t, stands === "done" ? "passed" : stands, stands === "failed" ? failed.length : ci.checks.length - running.length, ci.total)

  return {
    id: `${CI_ITEM_PREFIX}${key}`,
    label: `${status} ${ci.oid.slice(0, 7)}${failed.length === 0 ? "" : `: ${names(t, failed, false)}`}`,
    context: ciContext(t, ref, ci),
  }
}

/** What goes with a prompt, unasked, when CI of the branch's pull request has a result Claude was not told of. */
export function ciForPrompt(t: Messages, ref: PullRef, title: string, url: string, ci: Ci): string {
  return [t.ciToldFrom(pullName(ref), JSON.stringify(title), url), t.ciToldBackground, "", ciContext(t, ref, ci)].join("\n")
}
