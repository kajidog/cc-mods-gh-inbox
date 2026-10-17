import type { GhEvent, GhEventItem } from "../types"

import { CLOSED_ID, displayName, MERGED_ID, type Nicknames, snippet } from "./events"
import { type Json, login, object, type PullRef, pullName, text } from "./github"

export const KINDS = ["branch", "pr-open", "pr-merge", "pr-close", "comment", "review", "review-comment", "push", "ci-failure"] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABELS: Record<Kind, string> = {
  branch: "ブランチ作成",
  "pr-open": "PR 作成",
  "pr-merge": "PR マージ",
  "pr-close": "PR クローズ（マージなし）",
  comment: "PR・Issue へのコメント",
  review: "レビュー",
  "review-comment": "行へのコメント",
  push: "push",
  "ci-failure": "CI の失敗",
}

// `branch`, `push` and `review-comment` tend to come in numbers, so they start off.
export const DEFAULT_KINDS: readonly Kind[] = ["pr-open", "pr-merge", "comment", "review", "ci-failure"]

// Pushes looked into (one compare each) at one check; the rest are counted in one line.
export const PUSHES_LOOKED_UP = 5
const TITLES_SHOWN = 3
const ZERO_SHA = /^0+$/

/** Marks that this session has taken the failed runs already there as seen. */
export const ACTIONS_PRIMED = "actions:primed"

export const isKind = (value: string): value is Kind => (KINDS as readonly string[]).includes(value)

/** `kind,kind,...` in `KINDS` order, or the words that are not kinds. */
export function parseKinds(list: string): { kinds: Kind[]; unknown: string[] } {
  const words = list.split(",").map(word => word.trim()).filter(word => word !== "")
  return { kinds: KINDS.filter(kind => words.includes(kind)), unknown: words.filter(word => !isKind(word)) }
}

export type RepoRef = { host: string; owner: string; repo: string }

/** Reads `owner/repo`, `host/owner/repo` or a repository's URL. */
export function parseRepo(value: string): RepoRef | null {
  const words = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(word => word !== "")
  const [host, owner, repo] = words.length === 2 ? ["github.com", ...words] : words
  if (words.length < 2 || words.length > 3 || host === undefined || owner === undefined || repo === undefined) return null
  if (![owner, repo].every(word => /^[\w.-]+$/.test(word))) return null

  return { host, owner, repo }
}

/** `host/owner/repo`: the key a repository is registered and cached under. */
export const repoKey = (ref: RepoRef) => `${ref.host}/${ref.owner}/${ref.repo}`
export const repoName = (ref: RepoRef) => `${ref.owner}/${ref.repo}`
/** The key of a repository's seen ids beside the pull requests' `host/owner/repo#number`. */
export const repoSeenKey = (ref: RepoRef) => `repo:${repoKey(ref)}`
const webUrl = (ref: RepoRef, path: string) => `https://${ref.host}/${repoName(ref)}/${path}`

const ghApi = (ref: RepoRef) => ["gh", "api", ...(ref.host === "github.com" ? [] : ["--hostname", ref.host])]

/** Asks with the ETag held, headers included, so a `304` costs nothing. */
const conditional = (ref: RepoRef, path: string, etag: string | null) => [
  ...ghApi(ref),
  "-i",
  ...(etag === null ? [] : ["-H", `If-None-Match: ${etag}`]),
  path,
]

export const repoArgv = (ref: RepoRef) => [...ghApi(ref), `repos/${repoName(ref)}`, "--jq", ".full_name"]
export const eventsArgv = (ref: RepoRef, etag: string | null) => conditional(ref, `repos/${repoName(ref)}/events?per_page=100`, etag)
export const runsArgv = (ref: RepoRef, etag: string | null) =>
  conditional(ref, `repos/${repoName(ref)}/actions/runs?status=failure&per_page=20`, etag)
export const jobsArgv = (ref: RepoRef, run: Run) => [...ghApi(ref), `repos/${repoName(ref)}/actions/runs/${run.runId}/attempts/${run.attempt}/jobs`]
export const viewerArgv = (host: string) => [...ghApi({ host, owner: "", repo: "" }), "user", "--jq", ".login"]

// The compare answer carries every file's patch; only the counts are kept.
const COMPARE_JQ =
  '{commits: [.commits[] | {sha, title: (.commit.message | split("\\n")[0]), author: (.author.login // .commit.author.name)}], additions: ([.files[]?.additions] | add // 0), deletions: ([.files[]?.deletions] | add // 0)}'
export const compareArgv = (ref: RepoRef, push: { before: string; head: string }) => [
  ...ghApi(ref),
  `repos/${repoName(ref)}/compare/${push.before}...${push.head}`,
  "--jq",
  COMPARE_JQ,
]

/** One GraphQL request for the titles of several pull requests, each under its own alias. */
export function titlesArgv(ref: RepoRef, numbers: readonly number[]): string[] {
  const fields = numbers.map(number => `pr${number}: pullRequest(number: ${number}) { title author { login } }`).join(" ")
  return [
    ...ghApi(ref),
    "graphql",
    "-F",
    `owner=${ref.owner}`,
    "-F",
    `repo=${ref.repo}`,
    "-f",
    `query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`,
  ]
}

export type Response = { status: number; headers: Record<string, string>; body: string }

/** Reads `gh api -i`: the status line, the headers (names in lower case), a blank line, the body. */
export function parseResponse(output: string): Response {
  const match = /\r?\n\r?\n/.exec(output)
  const head = match === null ? output : output.slice(0, match.index)
  const body = match === null ? "" : output.slice(match.index + match[0].length)
  const [statusLine = "", ...lines] = head.split(/\r?\n/)
  const headers: Record<string, string> = {}
  for (const line of lines) {
    const colon = line.indexOf(":")
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }

  return { status: Number(/^HTTP\/\S+\s+(\d+)/.exec(statusLine)?.[1] ?? 0), headers, body }
}

export type PushCommit = { sha: string; title: string; author: string | null }
export type Changes = { commits: PushCommit[]; additions: number; deletions: number }

type Base = { id: string; actor: string | null; at: string }
export type RepoEvent =
  | (Base & { type: "branch"; ref: string })
  | (Base & { type: "pull"; action: "opened" | "merged" | "closed"; number: number })
  | (Base & { type: "comment"; number: number; isPull: boolean; body: string; url: string })
  | (Base & { type: "review"; number: number; reviewId: number; state: string; body: string; url: string })
  | (Base & {
      type: "review-comment"
      number: number
      reviewId: number
      path: string
      line: number | null
      hunk: string
      body: string
      url: string
    })
  | (Base & {
      type: "push"
      branch: string
      before: string
      head: string
      /** Absent until looked up; null where no compare answers (a new branch). */
      changes?: Changes | null
    })

const number = (value: unknown) => (typeof value === "number" ? value : 0)

/**
 * The events of `GET /repos/{owner}/{repo}/events` this mod notifies, oldest
 * first. `id` is what the seen ids record, shared with the pull request's
 * own notices: a comment's or review's node id, `merged:#n` for a merge.
 */
export function parseEvents(body: string): RepoEvent[] {
  const list: unknown = JSON.parse(body)
  if (!Array.isArray(list)) return []
  const events: RepoEvent[] = []
  for (const raw of list.map(object).reverse()) {
    const payload = object(raw.payload)
    const base = { actor: login(raw.actor), at: text(raw.created_at) }
    const eventId = `event:${text(raw.id)}`
    const pull = object(payload.pull_request)
    switch (raw.type) {
      case "CreateEvent":
        if (payload.ref_type === "branch") events.push({ ...base, id: eventId, type: "branch", ref: text(payload.ref) })
        break
      case "PullRequestEvent": {
        const action = payload.action
        const at = number(payload.number) || number(pull.number)
        if (action === "opened" || action === "merged" || action === "closed")
          events.push({ ...base, id: `${action}:#${at}`, type: "pull", action, number: at })
        break
      }
      case "IssueCommentEvent": {
        if (payload.action !== "created") break
        const comment = object(payload.comment)
        const issue = object(payload.issue)
        events.push({
          ...base,
          id: text(comment.node_id),
          type: "comment",
          number: number(issue.number),
          isPull: issue.pull_request !== undefined || /\/pull\/\d+/.test(text(issue.html_url)),
          body: text(comment.body),
          url: text(comment.html_url),
        })
        break
      }
      case "PullRequestReviewEvent": {
        const review = object(payload.review)
        events.push({
          ...base,
          id: text(review.node_id),
          type: "review",
          number: number(pull.number),
          reviewId: number(review.id),
          state: text(review.state).toLowerCase(),
          body: text(review.body),
          url: text(review.html_url),
        })
        break
      }
      case "PullRequestReviewCommentEvent": {
        if (payload.action !== "created") break
        const comment = object(payload.comment)
        const line = comment.line ?? comment.original_line
        events.push({
          ...base,
          id: text(comment.node_id),
          type: "review-comment",
          number: number(pull.number),
          reviewId: number(comment.pull_request_review_id),
          path: text(comment.path),
          line: typeof line === "number" ? line : null,
          hunk: text(comment.diff_hunk),
          body: text(comment.body),
          url: text(comment.html_url),
        })
        break
      }
      case "PushEvent": {
        const ref = text(payload.ref)
        if (!ref.startsWith("refs/heads/")) break
        events.push({
          ...base,
          id: eventId,
          type: "push",
          branch: ref.slice("refs/heads/".length),
          before: text(payload.before),
          head: text(payload.head),
        })
        break
      }
    }
  }

  return events
}

/** Whether a compare can say what a push brought: not a new branch, not a deletion. */
export const canCompare = (push: { before: string; head: string }) =>
  push.before !== "" && push.head !== "" && !ZERO_SHA.test(push.before) && !ZERO_SHA.test(push.head)

/** Reads `compareArgv`'s answer. */
export function parseCompare(answer: string): Changes {
  const json = object(JSON.parse(answer))
  const commits = Array.isArray(json.commits) ? json.commits.map(object) : []
  return {
    commits: commits.map(commit => ({ sha: text(commit.sha), title: text(commit.title), author: text(commit.author) || null })),
    additions: number(json.additions),
    deletions: number(json.deletions),
  }
}

export type Failure = { job: string; step: string | null }
export type Run = {
  /** `actions:<run id>:<attempt>`; a check run of the pull request's own notice is `run:<id>`, a different thing. */
  id: string
  runId: number
  attempt: number
  workflow: string
  branch: string
  url: string
  at: string
  /** Absent until looked up; null where no job says it failed. */
  failure?: Failure | null
}

/** Reads `GET /repos/{owner}/{repo}/actions/runs?status=failure`, oldest first. */
export function parseRuns(body: string): Run[] {
  const runs = object(JSON.parse(body)).workflow_runs
  if (!Array.isArray(runs)) return []
  return runs
    .map(object)
    .map(run => {
      const attempt = number(run.run_attempt) || 1
      return {
        id: `actions:${String(run.id)}:${attempt}`,
        runId: number(run.id),
        attempt,
        workflow: text(run.name),
        branch: text(run.head_branch),
        url: text(run.html_url),
        at: text(run.updated_at),
      }
    })
    .reverse()
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"])

/** The first failed job of a run and its failed step. */
export function parseJobs(body: string): Failure | null {
  const jobs = object(JSON.parse(body)).jobs
  const failed = (Array.isArray(jobs) ? jobs.map(object) : []).find(job => FAILED.has(text(job.conclusion)))
  if (failed === undefined) return null
  const steps = Array.isArray(failed.steps) ? failed.steps.map(object) : []
  const step = steps.find(one => FAILED.has(text(one.conclusion)))

  return { job: text(failed.name), step: step === undefined ? null : text(step.name) }
}

export type Title = { title: string; author: string | null }
export type Titles = Record<string, Title>

/** Reads `titlesArgv`'s answer; a number GitHub does not know is left out. */
export function parseTitles(answer: string): Titles {
  const repository = object(object(object(JSON.parse(answer)).data).repository)
  const titles: Titles = {}
  for (const [alias, value] of Object.entries(repository)) {
    const pull: Json = object(value)
    if (!alias.startsWith("pr") || typeof pull.title !== "string") continue
    titles[alias.slice(2)] = { title: pull.title, author: login(pull.author) }
  }

  return titles
}

/** The pull request numbers whose titles the notices of `events` show. */
export function numbersNeedingTitles(events: readonly RepoEvent[]): number[] {
  const numbers = events.flatMap(event => (event.type === "pull" || event.type === "review" ? [event.number] : []))
  return [...new Set(numbers)].filter(one => one > 0)
}

/**
 * Every id the repository shows now, as `newRepoEvents` records them;
 * `isPrimed` adds the mark that the runs there are known, once they have been asked for.
 */
export function repoIds(events: readonly RepoEvent[], runs: readonly Run[], isPrimed: boolean): string[] {
  return [
    ...events.flatMap(event => (event.type === "push" ? [event.id, event.head, ...(event.changes?.commits.map(commit => commit.sha) ?? [])] : [event.id])),
    ...runs.map(run => run.id),
    ...(isPrimed ? [ACTIONS_PRIMED] : []),
  ]
}

/**
 * The ids this session has seen for a repository, with those of its pull
 * requests' own notices: a comment notified there is not notified again here.
 * Undefined at the session's first look at the repository.
 */
export function seenForRepo(seenByKey: Readonly<Record<string, readonly string[]>>, ref: RepoRef): Set<string> | undefined {
  const own = seenByKey[repoSeenKey(ref)]
  if (own === undefined) return undefined
  const seen = new Set(own)
  const prefix = `${repoKey(ref)}#`
  for (const [key, ids] of Object.entries(seenByKey)) {
    if (!key.startsWith(prefix)) continue
    const at = key.slice(prefix.length)
    for (const id of ids) seen.add(id === MERGED_ID ? `merged:#${at}` : id === CLOSED_ID ? `closed:#${at}` : id)
  }

  return seen
}

/** The other way round: a pull request's seen ids with those its repository's notices took. */
export function seenForPull(seenByKey: Readonly<Record<string, readonly string[]>>, ref: PullRef): Set<string> | undefined {
  const own = seenByKey[`${ref.host}/${pullName(ref)}`]
  if (own === undefined) return undefined
  const seen = new Set(own)
  for (const id of seenByKey[repoSeenKey(ref)] ?? []) {
    seen.add(id === `merged:#${ref.number}` ? MERGED_ID : id === `closed:#${ref.number}` ? CLOSED_ID : id)
  }

  return seen
}

export type RepoInput = {
  ref: RepoRef
  /** Put in front of each notice: the repository's short name. */
  label: string
  kinds: readonly Kind[]
  events: readonly RepoEvent[]
  runs: readonly Run[]
  titles: Titles
  viewer: string
  /** A branch whose pull request this session watches already: its runs are notified there. */
  watchedBranch: string | null
}

export type RepoEventOptions = { nicknames: Nicknames; notifySelf: boolean }

/** The events `newRepoEvents` would notify, before any is turned into text: what the extra lookups are for. */
export function pendingEvents(input: Pick<RepoInput, "kinds" | "events" | "viewer">, seen: ReadonlySet<string>, notifySelf: boolean): RepoEvent[] {
  const isMuted = (actor: string | null) => !notifySelf && actor !== null && actor === input.viewer
  return input.events.filter(event => {
    if (seen.has(event.id)) return false
    switch (event.type) {
      case "branch":
        return input.kinds.includes("branch") && !isMuted(event.actor)
      case "pull":
        // A merge is notified even when it is mine, as the pull request's own notice does.
        if (event.action === "merged") return input.kinds.includes("pr-merge")
        return input.kinds.includes(event.action === "opened" ? "pr-open" : "pr-close") && !isMuted(event.actor)
      case "comment":
      case "review":
      case "review-comment":
        return input.kinds.includes(event.type) && !isMuted(event.actor)
      case "push":
        return input.kinds.includes("push") && !isMuted(event.actor) && !ZERO_SHA.test(event.head) && !seen.has(event.head)
    }
    return false
  })
}

/**
 * The notices for what `seen` does not hold yet, oldest first. Without `seen`
 * (the session's first look at the repository) nothing is notified.
 */
export function newRepoEvents(input: RepoInput, seen: ReadonlySet<string> | undefined, options: RepoEventOptions): GhEvent[] {
  if (seen === undefined) return []
  const { ref } = input
  const prefix = `[${input.label}] `
  const who = (actor: string | null) => `${displayName(actor, options.nicknames)}さん`
  const pullUrl = (at: number) => webUrl(ref, `pull/${at}`)
  const titleOf = (at: number) => input.titles[String(at)]?.title ?? ""
  const pending = pendingEvents(input, seen, options.notifySelf)
  const events: GhEvent[] = []
  const add = (event: Omit<GhEvent, "text" | "pull"> & { text: string; number?: number }) => {
    const { number: at, ...rest } = event
    events.push({ ...rest, pull: at === undefined ? repoName(ref) : `${repoName(ref)}#${at}`, text: `${prefix}${event.text}`.trimEnd() })
  }

  // A review's line comments go with the review when both are notified.
  const reviews = new Map<number, GhEventItem[]>()
  for (const event of pending) {
    if (event.type === "review" && reviewText(event, "") !== null) reviews.set(event.reviewId, [])
  }
  for (const event of pending) {
    if (event.type === "review-comment" && reviews.has(event.reviewId))
      reviews.get(event.reviewId)?.push({ body: event.body, path: event.path, line: event.line, hunk: event.hunk, url: event.url })
  }

  const unknownPushes: Array<RepoEvent & { type: "push" }> = []
  for (const event of pending) {
    const base = { id: event.id, author: event.actor, at: event.at }
    switch (event.type) {
      case "branch":
        add({ ...base, kind: "branch", text: `${who(event.actor)}がブランチを作りました。${event.ref}`, url: webUrl(ref, `tree/${event.ref}`), items: [] })
        break
      case "pull": {
        const title = titleOf(event.number)
        const common = { ...base, number: event.number, url: pullUrl(event.number), items: [] }
        if (event.action === "opened") add({ ...common, kind: "open", text: `${who(event.actor)}が PR を作りました。#${event.number} ${title}` })
        else if (event.action === "merged") add({ ...common, kind: "merge", text: `#${event.number} がマージされました。${title}` })
        else add({ ...common, kind: "close", text: `#${event.number} がクローズされました。${title}` })
        break
      }
      case "comment":
        add({
          ...base,
          kind: "comment",
          number: event.number,
          text: `${who(event.actor)}が${event.isPull ? "" : " Issue"} #${event.number} にコメントしました。${snippet(event.body)}`,
          url: event.url,
          items: [{ body: event.body, url: event.url }],
        })
        break
      case "review": {
        const said = reviewText(event, titleOf(event.number))
        if (said === null) break
        const comments = reviews.get(event.reviewId) ?? []
        add({
          ...base,
          kind: "review",
          number: event.number,
          text: `${who(event.actor)}${said}`,
          url: event.url,
          items: [...(event.body.trim() === "" ? [] : [{ body: event.body, url: event.url }]), ...comments],
        })
        break
      }
      case "review-comment":
        if (reviews.has(event.reviewId)) break
        add({
          ...base,
          kind: "comment",
          number: event.number,
          text: `${who(event.actor)}が #${event.number} にコメントしました。${event.path}${event.line === null ? "" : `:${event.line}`} ${snippet(event.body)}`,
          url: event.url,
          items: [{ body: event.body, path: event.path, line: event.line, hunk: event.hunk, url: event.url }],
        })
        break
      case "push": {
        if (event.changes === undefined) {
          unknownPushes.push(event)
          break
        }
        const pushed = `${who(event.actor)}が ${event.branch} に push しました。`
        if (event.changes === null) {
          add({ ...base, kind: "push", text: `${pushed}${event.head.slice(0, 7)}`, url: webUrl(ref, `commit/${event.head}`), items: [] })
          break
        }
        const commits = event.changes.commits.filter(commit => !seen.has(commit.sha))
        if (commits.length === 0) break
        const titles = commits.slice(0, TITLES_SHOWN).map(commit => commit.title)
        const more = commits.length > TITLES_SHOWN ? ` ほか${commits.length - TITLES_SHOWN}件` : ""
        add({
          ...base,
          kind: "push",
          text: `${pushed}${titles.join(" / ")}${more} (+${event.changes.additions} −${event.changes.deletions})`,
          url: webUrl(ref, `compare/${event.before}...${event.head}`),
          items: commits.map(commit => ({ body: commit.title, url: webUrl(ref, `commit/${commit.sha}`) })),
        })
        break
      }
    }
  }
  const lastUnknown = unknownPushes.at(-1)
  if (lastUnknown !== undefined) {
    add({
      id: lastUnknown.id,
      kind: "push",
      author: null,
      at: lastUnknown.at,
      text: `ほか${unknownPushes.length}件の push がありました。`,
      url: webUrl(ref, "activity"),
      items: [],
    })
  }

  if (input.kinds.includes("ci-failure") && seen.has(ACTIONS_PRIMED)) {
    for (const run of input.runs) {
      if (seen.has(run.id) || run.branch === input.watchedBranch) continue
      const name = run.failure ? `${run.workflow} / ${run.failure.job}` : run.workflow
      add({
        id: run.id,
        kind: "ci",
        author: null,
        at: run.at,
        text: `${name} の CI が失敗しました（${run.branch}）。${run.failure?.step ?? ""}`,
        url: run.url,
        items: run.failure?.step ? [{ body: run.failure.step, url: run.url }] : [],
      })
    }
  }

  const order = (event: GhEvent) => event.at || "￿"
  return events.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0))
}

/** What a review says after its author's name, or null for one not to notify. */
function reviewText(review: RepoEvent & { type: "review" }, title: string): string | null {
  const summary = snippet(review.body)
  if (review.state === "approved") return `が #${review.number} を承認しました。${summary || title}`
  if (review.state === "changes_requested") return `が #${review.number} で変更を依頼しました。${summary || title}`
  // A review of line comments alone says nothing itself: its comments are `review-comment`.
  if (review.state === "commented" && summary !== "") return `が #${review.number} をレビューしました。${summary}`
  return null
}
