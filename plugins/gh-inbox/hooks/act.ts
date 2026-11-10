// What `/inbox merge`, `/inbox close` and `/inbox draft` do to a pull request: whether it can be done now, and the
// `gh` command that does it once the person confirms it in the pane.

import type { GhActKind, GhPullStatus } from "../types"

import { object, type Pull, type PullRef, text } from "./github"
import type { Messages } from "./i18n"
import { MARKS, statusMarks } from "./status"

/** The merge methods in the order GitHub offers them. */
export const METHODS = ["MERGE", "SQUASH", "REBASE"] as const
export type Method = (typeof METHODS)[number]

export const isMethod = (value: unknown): value is Method => METHODS.includes(value as Method)

/** How the repository lets pull requests be merged: the methods it allows, the one to offer first, and whether auto-merge is on. */
export type MergeSettings = { methods: Method[]; preferred: Method | null; autoMergeAllowed: boolean }

/** The repository's merge settings: scalars, no connection, asked for only as a merge is about to be confirmed. */
const SETTINGS_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) { mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed viewerDefaultMergeMethod }
}`

/** The argv that asks the repository of `ref` for its merge settings. */
export function settingsArgv(ref: PullRef): string[] {
  return [
    "gh",
    "api",
    ...(ref.host === "github.com" ? [] : ["--hostname", ref.host]),
    "graphql",
    "-f",
    `owner=${ref.owner}`,
    "-f",
    `repo=${ref.repo}`,
    "-f",
    `query=${SETTINGS_QUERY}`,
  ]
}

/**
 * Reads `SETTINGS_QUERY`'s answer; throws with GitHub's own words when it carries errors. A repository that says
 * nothing of its methods (a GitHub Enterprise Server without the fields) is taken to allow them all: GitHub refuses
 * one it does not.
 */
export function parseSettings(answer: string): MergeSettings {
  const json = object(JSON.parse(answer))
  if (Array.isArray(json.errors) && json.errors.length > 0) throw new Error(text(object(json.errors[0]).message) || "GitHub answered with an error")
  const repository = object(object(json.data).repository)
  const allowed = { MERGE: repository.mergeCommitAllowed, SQUASH: repository.squashMergeAllowed, REBASE: repository.rebaseMergeAllowed }
  const isSaid = Object.values(allowed).some(value => typeof value === "boolean")
  const methods = METHODS.filter(method => !isSaid || allowed[method] === true)
  const viewers = text(repository.viewerDefaultMergeMethod)
  const preferred = isMethod(viewers) && methods.includes(viewers) ? viewers : (methods[0] ?? null)

  return { methods, preferred, autoMergeAllowed: repository.autoMergeAllowed === true }
}

/** A merge method as the person reads it (`squash`, `スカッシュ`); one GitHub added since, as GitHub words it. */
export const methodName = (t: Messages, method: string) => t.methods[method] ?? method.toLowerCase()

/** What a merge asked for comes to: done now, auto-merge turned on or off, or refused with why. */
export type MergePlan = { kind: Extract<GhActKind, "merge" | "auto" | "disable-auto">; notes: string[] } | { refusal: string }

/** What still keeps it from being merged, as the line under the prompt marks it: the failed, running and waiting parts. */
const holdingBack = (t: Messages, status: GhPullStatus) => {
  const parts = statusMarks(t, status).filter(part => [MARKS.failed, MARKS.running, MARKS.waiting].some(mark => part.startsWith(`${mark} `)))
  return parts.length === 0 ? "" : t.paren(parts.join(t.listSeparator))
}

/**
 * Whether the pull request can be merged now, as GitHub says of it, branch protection and all: merged at once when it
 * can, auto-merge turned on where the repository allows it while a required review or check is missing, refused
 * otherwise. Never past branch protection (no `--admin`). One with auto-merge on has it turned off instead.
 */
export function planMerge(t: Messages, pull: Pull, status: GhPullStatus, settings: MergeSettings): MergePlan {
  if (pull.autoMerge !== null) return { kind: "disable-auto", notes: [t.autoMergeIsOn(methodName(t, pull.autoMerge))] }
  if (pull.isDraft || pull.mergeState === "DRAFT") return { refusal: t.draftCannotMerge }
  if (pull.mergeable === "CONFLICTING" || pull.mergeState === "DIRTY") return { refusal: t.conflictsCannotMerge }
  if (pull.mergeState === "BEHIND") return { refusal: t.behindCannotMerge }
  if (pull.head === "") return { refusal: t.headUnknown }
  if (settings.methods.length === 0) return { refusal: t.noMethods }
  switch (pull.mergeState) {
    case "CLEAN":
    case "HAS_HOOKS":
      return { kind: "merge", notes: [] }
    case "UNSTABLE":
      return { kind: "merge", notes: [t.unstableNote] }
    case "BLOCKED":
      return settings.autoMergeAllowed ? { kind: "auto", notes: [t.autoNote(holdingBack(t, status))] } : { refusal: t.blockedCannotMerge(holdingBack(t, status)) }
    case "UNKNOWN":
      return { refusal: t.mergeUnknown }
    default:
      // GitHub said nothing of it: it refuses what branch protection does not allow.
      return pull.mergeable === "UNKNOWN" ? { refusal: t.mergeUnknown } : { kind: "merge", notes: [] }
  }
}

/** What GitHub is asked to do, by `gh`; a merge only while `head` is still the pull request's head commit. */
export function actArgv(kind: GhActKind, url: string, head: string, method: string | null): string[] {
  const merge = ["gh", "pr", "merge", url, `--${(method ?? "merge").toLowerCase()}`, "--match-head-commit", head]
  switch (kind) {
    case "merge":
      return merge
    case "auto":
      return [...merge, "--auto"]
    case "disable-auto":
      return ["gh", "pr", "merge", url, "--disable-auto"]
    case "close":
      return ["gh", "pr", "close", url]
    case "ready":
      return ["gh", "pr", "ready", url]
    case "draft":
      return ["gh", "pr", "ready", url, "--undo"]
  }
}

/** What `/inbox merge`'s words say apart from the pull request: a method named (`merge`, `squash`, `rebase`), and the rest. */
export function parseMergeWords(words: readonly string[]): { method: Method | undefined; rest: string[] } {
  const named = words.map(word => word.toUpperCase()).find(isMethod)
  return { method: named, rest: words.filter(word => !isMethod(word.toUpperCase())) }
}
