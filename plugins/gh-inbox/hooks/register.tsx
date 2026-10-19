import { atom, read, update } from "claude-code"
import type { EngineInterface, Register, Timer } from "claude-code"

import type { GhEvent, GhPick, GhPicker, GhPickPull, GhStaged, GhWatch, Inbox, InboxNotice } from "../types"

import { displayName, mergeSeen, newEvents, type Nicknames, plain, pullIds } from "./events"
import { type PullRef, type PullState, parsePull, parsePullUrl, pullArgv, pullName } from "./github"
import {
  addSharedSeen,
  HISTORIES_KEPT,
  HISTORY_PREFIX,
  latest,
  logText,
  MISSED_PREFIX,
  mergeHistories,
  newestAt,
  parseLog,
  SHARED_KEPT_MS,
  SHARED_SEEN_PREFIX,
  toKept,
  toMissed,
  toSessionHistory,
  toSharedSeen,
  unheld,
} from "./history"
import { type Language, MESSAGES, type Messages, toLanguage } from "./i18n"
import {
  CONTEXT_LIMIT,
  idsOf,
  parsePicked,
  parsePullArg,
  parsePulls,
  pickArgv,
  pullKeyOfUrl,
  pullsArgv,
  refOfPullKey,
  stagedContext,
  stagedCount,
  stagedSize,
} from "./pick"
import { PRESENCE_PREFIX, type Presence, pickActive, toPresence } from "./presence"
import {
  ACTIONS_PRIMED,
  canCompare,
  compareArgv,
  DEFAULT_KINDS,
  eventsArgv,
  isAnswerOf,
  isKind,
  jobsArgv,
  KINDS,
  type Kind,
  newRepoEvents,
  numbersNeedingTitles,
  numbersNotFound,
  PUSHES_LOOKED_UP,
  RUNS_LOOKED_UP,
  parseCompare,
  parseEvents,
  parseJobs,
  parseKinds,
  parseRepo,
  parseResponse,
  parseRuns,
  parseTitles,
  pendingEvents,
  type RepoRef,
  type Response,
  repoArgv,
  repoIds,
  repoKey,
  repoName,
  repoSeenKey,
  runsArgv,
  seenForPull,
  seenForRepo,
  type Titles,
  titlesArgv,
  viewerArgv,
} from "./repo-events"
import {
  addTitles,
  carryOver,
  DEFAULT_POLL_SECONDS,
  REPO_CACHE_PREFIX,
  REPOS_KEY,
  type RepoCache,
  type RepoEntry,
  type Repos,
  refOfKey,
  repoLabel,
  TITLES_PREFIX,
  toRepoCache,
  toRepos,
  toTitles,
} from "./repos"

const COMMAND = "inbox"
const NICKNAMES_KEY = "nicknames"
const EVENTS_KEPT = 100
const LOG_SHOWN = 20
const SHOWN_AT_ONCE = 5
const TOAST_MS = 8000
// A branch with no open pull request is looked up again this often, not at every check.
const LOOKUP_MS = 5 * 60 * 1000
const MIN_INTERVAL_SECONDS = 30
// A session that has not checked in for this many intervals is taken for gone.
const STALE_INTERVALS = 3
// Typing marks the session touched at most this often.
const TOUCH_MS = 10 * 1000
const CACHE_PREFIX = "cache:"
// Left behind by a session that never ended cleanly.
const PRESENCE_KEPT_MS = 24 * 60 * 60 * 1000
const CACHE_KEPT_MS = 60 * 60 * 1000
const PICKER_PANE = "gh-inbox-kinds"
const PICK_PANE = "gh-inbox-pick"
// Titles asked for in one GraphQL request at most.
const TITLES_AT_ONCE = 50
// A lookup that fails for now (no network, a rate limit) is tried at this many checks, its notice held meanwhile.
const LOOKUP_TRIES = 3

const events = atom({ plugin: "gh-inbox", key: "events" } as const, [] as GhEvent[])
const watch = atom({ plugin: "gh-inbox", key: "watch" } as const, null as GhWatch | null)
const seenIds = atom({ plugin: "gh-inbox", key: "seen" } as const, {} as Record<string, string[]>)
const picker = atom({ plugin: "gh-inbox", key: "picker" } as const, null as GhPicker | null)
const pick = atom({ plugin: "gh-inbox", key: "pick" } as const, null as GhPick | null)
const staged = atom({ plugin: "gh-inbox", key: "staged" } as const, [] as GhStaged[])

type Found = {
  branch: string
  ref: PullRef | null
  state: PullState | null
  lookedAt: number
  isDone: boolean
  /** The check at which the pull request was seen merged or closed. */
  doneAt?: number
  /** The newest commit of the pull request, whose checks its notices tell. */
  head?: string
}
// What a module load keeps between checks; a reload starts it over.
type Context = {
  intervalSeconds: number
  maxRepos: number
  channel: string
  notifySelf: boolean
  language: Language
  /** What the mod says, in `language`. */
  t: Messages
  found: Found | undefined
  /** The check under way, if one is. */
  running: Promise<void> | undefined
  /** How many checks have started. */
  checks: number
  sessionId: string
  activeAt: number
  touchedAt: number
  /** The login `gh` uses, by host. */
  viewers: Map<string, string>
  /** The last check's error, by `host/owner/repo`. */
  repoErrors: Map<string, string>
  /** The failed tries of a lookup tried again, by the id of its push or run. */
  retries: Map<string, number>
  /** The picker's toggles, one after another. */
  toggling: Promise<void>
  /** How many loads the pick pane has started: a load that is no longer the last one is not shown. */
  picking: number
  /** Whether the session has ended: a check still under way then does not mark it alive again. */
  isEnded: boolean
}

const pullKey = (ref: PullRef) => `${ref.host}/${pullName(ref)}`
/**
 * A check's notices: `fresh` came since this session last looked. At its first look, what came since any
 * session last looked is `missed` while no other session is alive, `adopted` while one is: that one may not
 * have told it yet, and this one may be the one showing.
 */
type Checked = { fresh: InboxNotice[]; missed: InboxNotice[]; adopted: InboxNotice[] }

const presenceKey = (ctx: Context) => `${PRESENCE_PREFIX}${ctx.sessionId}`
const historyKey = (ctx: Context) => `${HISTORY_PREFIX}${ctx.sessionId}`
const missedKey = (ctx: Context) => `${MISSED_PREFIX}${ctx.sessionId}`
const staleMs = (ctx: Context) => STALE_INTERVALS * ctx.intervalSeconds * 1000

function toNicknames(value: unknown): Nicknames {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

const firstLine = (text: string) => text.trim().split("\n")[0] ?? ""

const ago = (t: Messages, ms: number) => t.ago(Math.max(0, Math.round(ms / 1000)))

async function currentBranch($: EngineInterface) {
  const { exitCode, stdout } = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
  const branch = stdout.trim()
  return exitCode === 0 && branch !== "" && branch !== "HEAD" ? branch : null
}

async function lookUp($: EngineInterface, ctx: Context, branch: string, now: number): Promise<Found> {
  const { exitCode, stdout, stderr } = await $.process.run(["gh", "pr", "view", "--json", "url,state"])
  if (exitCode !== 0) {
    if (/no (?:open )?pull requests? found/i.test(stderr)) return { branch, ref: null, state: null, lookedAt: now, isDone: false }
    throw new Error(firstLine(stderr) || ctx.t.exitedWith("gh pr view", exitCode))
  }
  const answer = JSON.parse(stdout) as { url?: string; state?: PullState }
  const ref = parsePullUrl(answer.url ?? "")

  return { branch, ref, state: answer.state ?? null, lookedAt: now, isDone: false }
}

async function show($: EngineInterface, ctx: Context, notices: readonly InboxNotice[]) {
  // Each notice goes past the hooks on `inbox.notify` first: one they refuse is not shown.
  const list: InboxNotice[] = []
  for (const notice of notices) {
    const passed = await $.inbox.notify(notice).catch(() => undefined)
    if (passed !== undefined) list.push(passed)
  }
  const shown = list.length > SHOWN_AT_ONCE ? [...list.slice(0, SHOWN_AT_ONCE - 1)] : list
  // A hook may have built the text from what anyone wrote on GitHub: made plain again, as it shows.
  const final = list.map(notice => ({ ...notice, text: plain(notice.text) }))
  const lines = final.slice(0, shown.length).map(notice => notice.text)
  if (shown.length < list.length) lines.push(ctx.t.moreUpdates(list.length - shown.length))
  for (const line of lines) {
    if (ctx.channel === "log") $.ui.log(`GitHub: ${line}`)
    else if (ctx.channel === "notify") {
      const sent = await $.ui.notify(line, { title: "GitHub" }).catch(() => ({ isSent: false }))
      if (!sent.isSent) $.ui.toast(line, { timeoutMs: TOAST_MS })
    } else $.ui.toast(line, { timeoutMs: TOAST_MS })
  }
  // Told once every hook on `inbox.notify` has answered, so what a hook there does is what shows.
  for (const notice of final) await $.inbox.notified(notice).catch(() => undefined)
}

/** Writes this session's presence: touched now when `isTouch`, alive now either way. */
async function touch($: EngineInterface, ctx: Context, isTouch: boolean) {
  if (ctx.sessionId === "" || ctx.isEnded) return
  const now = await $.clock.now()
  if (ctx.isEnded) return
  if (isTouch) ctx.activeAt = now
  ctx.touchedAt = now
  const presence: Presence = { activeAt: ctx.activeAt, aliveAt: now }
  await $.store.set(presenceKey(ctx), presence)
}

/** Whether this session is the one the person touched last among those alive. */
async function isShowing($: EngineInterface, ctx: Context, now: number) {
  const entries: Array<readonly [string, Presence]> = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PRESENCE_PREFIX)) continue
    const presence = toPresence(await $.store.get(key))
    if (presence !== undefined) entries.push([key.slice(PRESENCE_PREFIX.length), presence])
  }
  const active = pickActive(entries, now, staleMs(ctx))

  return active === undefined || active === ctx.sessionId
}

/** Whether a session other than this one is alive: one that may not have told what came lately yet. */
async function isAnotherAlive($: EngineInterface, ctx: Context, now: number) {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PRESENCE_PREFIX) || key === presenceKey(ctx)) continue
    const presence = toPresence(await $.store.get(key))
    if (presence !== undefined && now - presence.aliveAt <= staleMs(ctx)) return true
  }

  return false
}

/** Removes what sessions that never ended cleanly left behind. */
async function tidy($: EngineInterface, now: number) {
  const repos = toRepos(await $.store.get(REPOS_KEY))
  const histories: Array<[string, number]> = []
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    if (key.startsWith(PRESENCE_PREFIX)) {
      const presence = toPresence(value)
      if (presence === undefined || now - presence.aliveAt > PRESENCE_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(CACHE_PREFIX)) {
      const at = typeof value === "object" && value !== null ? (value as { at?: unknown }).at : undefined
      if (typeof at !== "number" || now - at > CACHE_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(REPO_CACHE_PREFIX)) {
      if (now - (toRepoCache(value)?.at ?? 0) > CACHE_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(SHARED_SEEN_PREFIX)) {
      if (now - (toSharedSeen(value)?.at ?? 0) > SHARED_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(MISSED_PREFIX)) {
      if (now - (toMissed(value)?.at ?? 0) > SHARED_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(HISTORY_PREFIX)) {
      const history = toSessionHistory(value)
      if (history === undefined || now - history.at > SHARED_KEPT_MS) await $.store.delete(key)
      else histories.push([key, newestAt(history)])
    } else if (key.startsWith(TITLES_PREFIX)) {
      if (!(key.slice(TITLES_PREFIX.length) in repos)) await $.store.delete(key)
    } else if (key.startsWith("seen:")) {
      // Seen ids were shared by every session before 0.1.0 was released; each session keeps its own now.
      await $.store.delete(key)
    }
  }
  // The sessions whose newest notices are the newest are kept: each kept one has a notice newer than any dropped one's,
  // so the log's newest `HISTORIES_KEPT` are all still there.
  histories.sort((a, b) => b[1] - a[1])
  for (const [key] of histories.slice(HISTORIES_KEPT)) await $.store.delete(key)
}

/** Every session's notices, each once. */
async function readHistory($: EngineInterface) {
  const histories: GhEvent[][] = []
  for (const key of await $.store.keys())
    if (key.startsWith(HISTORY_PREFIX)) histories.push(toSessionHistory(await $.store.get(key))?.events ?? [])

  return mergeHistories(histories)
}

/** Writes this session's notices where every session reads them. */
async function writeHistory($: EngineInterface, ctx: Context, now: number) {
  const { value: list = [] } = await $.state.get({ plugin: "gh-inbox", key: "events" })
  if (list.length > 0) await $.store.set(historyKey(ctx), toKept(list, now))
}

/** How many notices sessions caught up while not showing them, taken off the store; a count older than what the log keeps is dropped. */
async function claimMissed($: EngineInterface, now: number) {
  let count = 0
  for (const key of await $.store.keys()) {
    if (!key.startsWith(MISSED_PREFIX)) continue
    const missed = toMissed(await $.store.get(key))
    if (missed !== undefined && now - missed.at <= SHARED_KEPT_MS) count += missed.count
    await $.store.delete(key)
  }

  return count
}

/** The ids any session has seen, keyed as a session's own. */
async function sharedSeen($: EngineInterface) {
  const byKey: Record<string, string[]> = {}
  for (const key of await $.store.keys()) {
    if (!key.startsWith(SHARED_SEEN_PREFIX)) continue
    const seen = toSharedSeen(await $.store.get(key))
    if (seen !== undefined) byKey[key.slice(SHARED_SEEN_PREFIX.length)] = seen.ids
  }

  return byKey
}

/** Adds `ids` to what every session has seen under `key`; `keep` filters what was there. */
async function shareSeen($: EngineInterface, key: string, ids: readonly string[], now: number, keep: (id: string) => boolean = () => true) {
  const held = toSharedSeen(await $.store.get(`${SHARED_SEEN_PREFIX}${key}`))
  await $.store.set(`${SHARED_SEEN_PREFIX}${key}`, addSharedSeen(held && { ...held, ids: held.ids.filter(keep) }, ids, now))
}

/**
 * The pull request as GitHub answers `PULL_QUERY`: another session's answer
 * when it is younger than one interval, so sessions watching the same pull
 * request ask GitHub once between them.
 */
async function fetchPull($: EngineInterface, ctx: Context, ref: PullRef, now: number) {
  const key = `${CACHE_PREFIX}${pullKey(ref)}`
  const cached = await $.store.get(key)
  if (typeof cached === "object" && cached !== null) {
    const { at, text } = cached as { at?: unknown; text?: unknown }
    if (typeof at === "number" && typeof text === "string" && now - at < ctx.intervalSeconds * 1000) return parsePull(ref, text, ctx.language)
  }
  const fetched = await $.process.run(pullArgv(ref))
  if (fetched.exitCode !== 0) throw new Error(firstLine(fetched.stderr) || ctx.t.exitedWith("gh api", fetched.exitCode))
  const pull = parsePull(ref, fetched.stdout, ctx.language)
  await $.store.set(key, { at: now, text: fetched.stdout })

  return pull
}

/** Which of a check's lists a first look (`own` undefined) or a later one puts its notices in. */
async function bucketOf($: EngineInterface, ctx: Context, own: unknown, now: number): Promise<keyof Checked> {
  if (own !== undefined) return "fresh"
  return (await isAnotherAlive($, ctx, now)) ? "adopted" : "missed"
}

/** Checks the branch's pull request; its notices go to `checked`. */
async function checkPull($: EngineInterface, ctx: Context, checked: Checked, isForced: boolean) {
  try {
    const branch = await currentBranch($)
    if (branch === null) {
      ctx.found = undefined
      await update($, watch, () => ({ branch: null, pull: null, title: null, url: null, state: null, checkedAt: null, error: null }))
      return
    }
    const now = await $.clock.now()
    const isStale = ctx.found !== undefined && (ctx.found.ref === null || ctx.found.isDone) && now - ctx.found.lookedAt > LOOKUP_MS
    if (isForced || ctx.found === undefined || ctx.found.branch !== branch || isStale) {
      const before = ctx.found
      ctx.found = await lookUp($, ctx, branch, now)
      // The same closed pull request found again has nothing more to say.
      if (before?.isDone && before.ref !== null && ctx.found.ref !== null && pullName(before.ref) === pullName(ctx.found.ref) && ctx.found.state !== "OPEN")
        ctx.found.isDone = true
    }
    const ref = ctx.found.ref
    if (ref === null) {
      await update($, watch, () => ({ branch, pull: null, title: null, url: null, state: null, checkedAt: now, error: null }))
      return
    }
    if (ctx.found.isDone) return

    const pull = await fetchPull($, ctx, ref, now)

    // Each session keeps its own seen ids, so every session lists every notice from its start.
    // Those a registered repository's notices took count too, so nothing is notified twice.
    const key = pullKey(ref)
    const { value: seenByKey = {} } = await $.state.get({ plugin: "gh-inbox", key: "seen" })
    const own = seenForPull(seenByKey, ref)
    const seen = own ?? seenForPull(await sharedSeen($), ref)
    const bucket = checked[await bucketOf($, ctx, own, now)]
    const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
    const isSelf = (event: GhEvent) => event.author !== null && event.author === pull.viewer
    for (const event of newEvents(pull, seen, { nicknames, notifySelf: ctx.notifySelf, language: ctx.language }))
      bucket.push({ event, source: "pull", repo: repoKey(ref), label: null, isSelf: isSelf(event), text: plain(event.text) })
    await update($, seenIds, held => ({ ...held, [key]: mergeSeen(held[key] ?? [], pullIds(pull)) }))
    await shareSeen($, key, pullIds(pull), now)

    ctx.found.head = pull.commits.at(-1)?.oid
    if (pull.state !== "OPEN") {
      ctx.found.isDone = true
      ctx.found.doneAt = ctx.checks
    }
    await update($, watch, () => ({
      branch,
      pull: pullName(ref),
      title: pull.title,
      url: pull.url,
      state: pull.state,
      checkedAt: now,
      error: null,
    }))
    if (own === undefined && pull.state === "OPEN" && (await isShowing($, ctx, now)))
      $.ui.toast(ctx.t.startWatching(ref.number, plain(pull.title)), { timeoutMs: TOAST_MS })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, watch, held => ({
      branch: held?.branch ?? null,
      pull: held?.pull ?? null,
      title: held?.title ?? null,
      url: held?.url ?? null,
      state: held?.state ?? null,
      checkedAt: held?.checkedAt ?? null,
      error: message,
    }))
    $.ui.log(`gh-inbox: ${message}`, { to: "debug" })
  }
}

/** Runs a conditional `gh api -i`; a `304` answers with nothing changed. */
async function ask($: EngineInterface, ctx: Context, argv: string[]): Promise<Response> {
  const run = await $.process.run(argv)
  const response = parseResponse(run.stdout)
  if (response.status === 304) return response
  if (run.exitCode !== 0 || response.status !== 200)
    throw new Error(firstLine(run.stderr) || (response.status ? ctx.t.githubAnswered(response.status) : ctx.t.exitedWith("gh api", run.exitCode)))

  return response
}

async function viewerOf($: EngineInterface, ctx: Context, host: string) {
  const held = ctx.viewers.get(host)
  if (held !== undefined) return held
  const run = await $.process.run(viewerArgv(host))
  const viewer = run.exitCode === 0 ? run.stdout.trim() : ""
  if (viewer !== "") ctx.viewers.set(host, viewer)

  return viewer
}

/**
 * A repository's events and failed runs: the shared answer while it is younger
 * than the interval (and GitHub's `X-Poll-Interval`), else asked again with
 * the ETags held, so an unchanged repository costs nothing.
 */
async function fetchRepo($: EngineInterface, ctx: Context, ref: RepoRef, entry: RepoEntry, now: number): Promise<RepoCache> {
  const { kinds, id } = entry
  const key = `${REPO_CACHE_PREFIX}${repoKey(ref)}`
  const cached = toRepoCache(await $.store.get(key))
  const isFresh = cached !== undefined && now - cached.at < Math.max(ctx.intervalSeconds, cached.poll) * 1000
  const wantsRuns = kinds.includes("ci-failure")
  // Runs are asked for only while `ci-failure` is chosen; chosen later, they are asked for at once.
  const needsRuns = wantsRuns && (cached === undefined || cached.runsEtag === null)
  // Runs no longer asked for are dropped, so choosing `ci-failure` again asks for them anew before they count as seen.
  const dropsRuns = !wantsRuns && cached !== undefined && cached.runsEtag !== null
  if (isFresh && !needsRuns && !dropsRuns) return cached

  let next: RepoCache = cached ?? { at: now, etag: null, poll: DEFAULT_POLL_SECONDS, events: [], runsEtag: null, runs: [] }
  if (dropsRuns) next = { ...next, runsEtag: null, runs: [] }
  if (!isFresh) {
    const answer = await ask($, ctx, eventsArgv(ref, next.etag || null))
    if (answer.status === 200 && id !== undefined && !isAnswerOf(answer.body, id))
      throw new Error(ctx.t.repoMoved)
    if (answer.status === 200) next = { ...next, etag: answer.headers.etag ?? null, events: parseEvents(answer.body) }
    next = { ...next, at: now, poll: Number(answer.headers["x-poll-interval"]) || next.poll }
  }
  if (wantsRuns) {
    // Runs that cannot be read (Actions turned off, a token without `actions:read`) do not stop the events.
    try {
      const answer = await ask($, ctx, runsArgv(ref, next.runsEtag || null))
      if (answer.status === 200 && id !== undefined && !isAnswerOf(answer.body, id)) throw new Error(ctx.t.repoMoved)
      if (answer.status === 200) next = { ...next, runsEtag: answer.headers.etag ?? "", runs: parseRuns(answer.body) }
    } catch (error) {
      ctx.repoErrors.set(repoKey(ref), `CI: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  next = { ...next, ...carryOver(cached, next) }
  await $.store.set(key, next)

  return next
}

// GitHub saying a lookup never works: a compare across a force push, a deleted run.
const isFinal = (stderr: string) => /\(HTTP 4(?:04|22)\)/.test(stderr)

/**
 * Looks up what the notices about to be made need: the commits of pushes, the
 * failed step of runs. What failed for now is `deferred`, tried again at the next check.
 */
async function lookUpDetails(
  $: EngineInterface,
  ctx: Context,
  ref: RepoRef,
  cache: RepoCache,
  pending: ReturnType<typeof pendingEvents>,
  runs: RepoCache["runs"],
): Promise<{ cache: RepoCache; deferred: Set<string> }> {
  const deferred = new Set<string>()
  // Whether a failed lookup is given up, its notice told without it; else it waits for the next check.
  const givesUp = (id: string, stderr: string) => {
    const tries = (ctx.retries.get(id) ?? 0) + 1
    if (isFinal(stderr) || tries >= LOOKUP_TRIES) {
      ctx.retries.delete(id)
      return true
    }
    ctx.retries.set(id, tries)
    deferred.add(id)
    return false
  }
  const pushes = pending.flatMap(event => (event.type === "push" && event.changes === undefined ? [event] : [])).slice(-PUSHES_LOOKED_UP)
  const changes = new Map<string, ReturnType<typeof parseCompare> | null>()
  for (const push of pushes) {
    if (!canCompare(push)) {
      changes.set(push.id, null)
      continue
    }
    // A force push leaves `before` out of the history: the compare fails, and the head alone is told.
    const run = await $.process.run(compareArgv(ref, push))
    if (run.exitCode === 0) {
      ctx.retries.delete(push.id)
      changes.set(push.id, parseCompare(run.stdout))
    } else if (givesUp(push.id, run.stderr)) changes.set(push.id, null)
  }
  const failures = new Map<string, ReturnType<typeof parseJobs>>()
  for (const one of runs.filter(run => run.failure === undefined).slice(-RUNS_LOOKED_UP)) {
    const run = await $.process.run(jobsArgv(ref, one))
    if (run.exitCode === 0) {
      ctx.retries.delete(one.id)
      failures.set(one.id, parseJobs(run.stdout))
    } else if (givesUp(one.id, run.stderr)) failures.set(one.id, null)
  }
  if (changes.size === 0 && failures.size === 0) return { cache, deferred }

  const looked: RepoCache = {
    ...cache,
    events: cache.events.map(event => (event.type === "push" && changes.has(event.id) ? { ...event, changes: changes.get(event.id) ?? null } : event)),
    runs: cache.runs.map(run => (failures.has(run.id) ? { ...run, failure: failures.get(run.id) ?? null } : run)),
  }
  // Another session may have asked GitHub meanwhile: what was looked up goes onto the newest answer.
  const key = `${REPO_CACHE_PREFIX}${repoKey(ref)}`
  const latest = toRepoCache(await $.store.get(key)) ?? looked
  await $.store.set(key, { ...latest, ...carryOver(looked, latest) })

  return { cache: looked, deferred }
}

/** The titles the notices need, asked for once in one GraphQL request and kept in the store. */
async function titlesFor($: EngineInterface, ref: RepoRef, pending: ReturnType<typeof pendingEvents>) {
  const key = `${TITLES_PREFIX}${repoKey(ref)}`
  const held = toTitles(await $.store.get(key))
  const missing = numbersNeedingTitles(pending).filter(number => !(String(number) in held))
  if (missing.length === 0) return held
  let fresh = {}
  // Asked for in batches, so every notice about to be made has its title.
  for (let start = 0; start < missing.length; start += TITLES_AT_ONCE) {
    // A number GitHub does not know fails the request, but the answer still holds the others.
    const run = await $.process.run(titlesArgv(ref, missing.slice(start, start + TITLES_AT_ONCE)))
    try {
      // A number with no pull request is kept untitled, so it is not asked for again; one failed for now is asked again.
      const untitled = numbersNotFound(run.stdout).map(number => [String(number), { title: "", author: null }])
      fresh = { ...fresh, ...Object.fromEntries(untitled), ...parseTitles(run.stdout) }
    } catch {
      $.ui.log(`gh-inbox: titles of ${repoName(ref)}: ${firstLine(run.stderr)}`, { to: "debug" })
    }
  }
  const titles = addTitles(held, fresh)
  await $.store.set(key, titles)

  return titles
}

/** Checks one registered repository; its notices are returned, and the list of a check they go in. */
async function checkRepo(
  $: EngineInterface,
  ctx: Context,
  key: string,
  entry: RepoEntry,
  nicknames: Nicknames,
  now: number,
): Promise<{ notices: InboxNotice[]; bucket: keyof Checked }> {
  const ref = refOfKey(key)
  let cache = await fetchRepo($, ctx, ref, entry, now)
  const seenKey = repoSeenKey(ref)
  const { value: seenByKey = {} } = await $.state.get({ plugin: "gh-inbox", key: "seen" })
  const own = seenForRepo(seenByKey, ref)
  const seen = own ?? seenForRepo(await sharedSeen($), ref)
  const watched = ctx.found
  // The check that sees the pull request merged or closed tells its failed checks too: their runs are not told twice.
  const isWatched = watched !== undefined && (!watched.isDone || watched.doneAt === ctx.checks)
  const watchedHead = isWatched && watched.ref !== null && repoKey(watched.ref) === key ? (watched.head ?? null) : null

  let viewer = ""
  let titles: Titles = {}
  let deferred = new Set<string>()
  if (seen !== undefined) {
    viewer = await viewerOf($, ctx, ref.host)
    // Without it the person's own activity would pass for someone else's: the repository waits for the next check.
    if (viewer === "") throw new Error(ctx.t.viewerUnknown)
    const pending = pendingEvents({ kinds: entry.kinds, events: cache.events, viewer }, seen, ctx.notifySelf)
    const isPrimed = entry.kinds.includes("ci-failure") && seen.has(ACTIONS_PRIMED)
    const failedRuns = isPrimed ? cache.runs.filter(run => !seen.has(run.id) && run.headSha !== watchedHead) : []
    ;({ cache, deferred } = await lookUpDetails($, ctx, ref, cache, pending, failedRuns))
    titles = await titlesFor($, ref, pending)
  }
  // What waits for a lookup is neither notified nor taken as seen yet.
  const events = cache.events.filter(event => !deferred.has(event.id))
  const runs = cache.runs.filter(run => !deferred.has(run.id))
  const label = repoLabel(key, entry)
  const fresh = newRepoEvents(
    { ref, label, kinds: entry.kinds, events, runs, titles, viewer, watchedHead },
    seen,
    { nicknames, notifySelf: ctx.notifySelf, language: ctx.language },
  )
  // Ids of every kind are kept, so a kind chosen later does not bring back old events.
  const wantsRuns = entry.kinds.includes("ci-failure") && cache.runsEtag !== null
  const ids = repoIds(events, runs, wantsRuns)
  await update($, seenIds, held => ({
    ...held,
    // Not choosing `ci-failure` drops the mark, so choosing it again starts from the runs there by then.
    [seenKey]: mergeSeen((held[seenKey] ?? []).filter(id => wantsRuns || id !== ACTIONS_PRIMED), ids),
  }))
  await shareSeen($, seenKey, ids, now, id => wantsRuns || id !== ACTIONS_PRIMED)

  const notices = fresh.map(event => ({
    event,
    source: "repo" as const,
    repo: key,
    label,
    isSelf: viewer !== "" && event.author === viewer,
    text: plain(event.text),
  }))

  return { notices, bucket: await bucketOf($, ctx, own, now) }
}

/** Checks every registered repository; their notices go to `checked`. */
async function checkRepos($: EngineInterface, ctx: Context, checked: Checked) {
  const repos = Object.entries(toRepos(await $.store.get(REPOS_KEY))).slice(0, ctx.maxRepos)
  if (repos.length === 0) return
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  const now = await $.clock.now()
  for (const [key, entry] of repos) {
    ctx.repoErrors.delete(key)
    // With no kind chosen GitHub is not asked; chosen again, the repository starts over from a first look.
    if (entry.kinds.length === 0) {
      await update($, seenIds, ({ [repoSeenKey(refOfKey(key))]: _, ...others }) => others)
      await $.store.delete(`${SHARED_SEEN_PREFIX}${repoSeenKey(refOfKey(key))}`)
      continue
    }
    try {
      const { notices, bucket } = await checkRepo($, ctx, key, entry, nicknames, now)
      checked[bucket].push(...notices)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.repoErrors.set(key, message)
      $.ui.log(`gh-inbox: ${repoName(refOfKey(key))}: ${message}`, { to: "debug" })
    }
  }
}

/** Checks now; a forced check waits for one under way and checks again after it, the timer's is skipped. */
async function check($: EngineInterface, ctx: Context, isForced = false) {
  if (ctx.running !== undefined && !isForced) return
  while (ctx.running !== undefined) await ctx.running
  ctx.running = runCheck($, ctx, isForced)
  await ctx.running
}

async function runCheck($: EngineInterface, ctx: Context, isForced: boolean) {
  ctx.checks += 1
  try {
    const checked: Checked = { fresh: [], missed: [], adopted: [] }
    await checkPull($, ctx, checked, isForced)
    await checkRepos($, ctx, checked)
    await touch($, ctx, false)
    const { fresh, missed, adopted } = checked
    const now = await $.clock.now()
    // Only the one touched last shows them.
    const isShown = await isShowing($, ctx, now)
    if (fresh.length > 0 || missed.length > 0 || adopted.length > 0) {
      // What no session had listed and this one does not show is only listed: a toast says how much, from the session showing.
      const unshown = isShown ? missed : [...missed, ...adopted]
      const caughtUp = unheld(await readHistory($), unshown.map(notice => notice.event)).length
      // One with no time of its own (a failed check of a commit with none) is kept as of when it was seen.
      const seenAt = new Date(now).toISOString()
      const added = [...missed, ...adopted, ...fresh].map(({ event }) => (event.at === "" ? { ...event, at: seenAt } : event))
      await update($, events, list => latest([...list, ...added], EVENTS_KEPT))
      await writeHistory($, ctx, now)
      if (caughtUp > 0) await $.store.set(missedKey(ctx), { at: now, count: (toMissed(await $.store.get(missedKey(ctx)))?.count ?? 0) + caughtUp })
    }
    if (!isShown) return
    const caughtUp = await claimMissed($, now)
    if (caughtUp > 0) $.ui.toast(ctx.t.missed(caughtUp), { timeoutMs: TOAST_MS })
    const shown = [...adopted, ...fresh]
    if (shown.length > 0) await show($, ctx, shown)
  } catch (error) {
    $.ui.log(`gh-inbox: ${error instanceof Error ? error.message : String(error)}`, { to: "debug" })
  } finally {
    ctx.running = undefined
  }
}

async function status($: EngineInterface, ctx: Context) {
  const { value: held } = await $.state.get({ plugin: "gh-inbox", key: "watch" })
  const now = await $.clock.now()
  const { t } = ctx
  const lines: string[] = []
  if (held === undefined || held === null || held.branch === null) lines.push(t.noBranch)
  else if (held.pull === null) lines.push(t.noPull(held.branch))
  else lines.push(`${held.pull} ${held.title ?? ""}${t.paren(t.pullState(held.state))}`)
  if (held?.checkedAt != null) lines.push(t.lastChecked(ago(t, now - held.checkedAt), ctx.intervalSeconds))
  if (held?.error != null) lines.push(t.error(held.error))
  const repos = Object.keys(toRepos(await $.store.get(REPOS_KEY))).length
  if (repos > 0) lines.push(t.registeredCount(repos))
  lines.push((await isShowing($, ctx, now)) ? t.showsHere : t.showsElsewhere)

  return lines.map(plain).join("\n")
}

const kindList = (t: Messages, kinds: readonly Kind[]) => (kinds.length === 0 ? t.noKinds : kinds.map(kind => t.kinds[kind]).join(t.listSeparator))

async function readRepos($: EngineInterface) {
  return toRepos(await $.store.get(REPOS_KEY))
}

/** Changes one repository's entry: read, changed and written at once, as every session writes the same key. */
async function writeRepo($: EngineInterface, key: string, change: (entry: RepoEntry | undefined) => RepoEntry | undefined) {
  const { [key]: entry, ...others } = await readRepos($)
  const changed = change(entry)
  const repos: Repos = changed === undefined ? others : { ...others, [key]: changed }
  await $.store.set(REPOS_KEY, repos)
}

async function openPicker($: EngineInterface, ctx: Context, key: string, kinds: readonly Kind[]) {
  await update($, picker, () => ({ repo: key, kinds: [...kinds] }))
  const opened = await $.ui.open({ id: PICKER_PANE, title: ctx.t.pickerTitle(repoName(refOfKey(key))), focus: true })

  return opened.isPlaced
}

/** Turns one kind of the picker's repository on or off, saved at once. */
async function toggleKind($: EngineInterface, kind: Kind) {
  const held = await read($, picker)
  if (held === null) return
  const chosen = held.kinds.includes(kind) ? held.kinds.filter(one => one !== kind) : [...held.kinds, kind]
  const kinds = KINDS.filter(one => chosen.includes(one))
  await update($, picker, () => ({ ...held, kinds }))
  await writeRepo($, held.repo, entry => (entry === undefined ? undefined : { ...entry, kinds }))
}

async function repoCommand($: EngineInterface, ctx: Context, words: readonly string[]): Promise<string> {
  const { t } = ctx
  const usage = t.repoUsage(KINDS.join(", "))
  const [action, name, value] = words
  const repos = await readRepos($)
  if (action === undefined) {
    const entries = Object.entries(repos)
    if (entries.length === 0) return `${t.noRepos}\n${usage}`
    const now = await $.clock.now()
    const lines: string[] = []
    for (const [index, [key, entry]] of entries.entries()) {
      const cache = toRepoCache(await $.store.get(`${REPO_CACHE_PREFIX}${key}`))
      const label = entry.alias === undefined ? "" : ` [${entry.alias}]`
      const paused = index >= ctx.maxRepos ? t.overLimit(ctx.maxRepos) : entry.kinds.length === 0 ? t.noKindsChosen : ""
      lines.push(`${repoName(refOfKey(key))}${label}: ${kindList(t, entry.kinds)}${paused}`)
      if (cache !== undefined) lines.push(`  ${t.lastCheckedRepo(ago(t, now - cache.at))}`)
      const error = ctx.repoErrors.get(key)
      if (error !== undefined) lines.push(`  ${t.error(plain(error))}`)
    }
    return lines.join("\n")
  }
  if (!["add", "set", "remove", "alias"].includes(action)) return usage
  const ref = name === undefined ? null : parseRepo(name)
  if (ref === null) return `${t.repoFormat}\n${usage}`
  // GitHub tells names apart without case: the repository registered is found whatever the case typed.
  const key = Object.keys(repos).find(one => one.toLowerCase() === repoKey(ref).toLowerCase()) ?? repoKey(ref)
  const shown = repoName(refOfKey(key))
  const entry = repos[key]
  if (action !== "add" && entry === undefined) return t.notRegistered(shown)

  let kinds: Kind[] | undefined
  if ((action === "add" || action === "set") && value !== undefined) {
    const parsed = parseKinds(value)
    if (parsed.unknown.length > 0) return t.unknownKinds(parsed.unknown.join(", "), KINDS.join(", "))
    kinds = parsed.kinds
  }

  switch (action) {
    case "add": {
      if (entry !== undefined) return t.alreadyRegistered(shown, kindList(t, entry.kinds))
      if (Object.keys(repos).length >= ctx.maxRepos) return t.tooMany(ctx.maxRepos)
      const found = await $.process.run(repoArgv(ref))
      if (found.exitCode !== 0) return t.cannotRead(shown, firstLine(found.stderr) || t.exitedWith("gh api", found.exitCode))
      // Registered as GitHub spells it, the key a pull request's URL gives, so their notices are told once.
      const [id = "", fullName = ""] = found.stdout.trim().split("\n")
      const named = parseRepo(`${ref.host}/${fullName}`) ?? ref
      const held = repos[repoKey(named)]
      if (held !== undefined) return t.alreadyRegistered(repoName(named), kindList(t, held.kinds))
      const chosen = kinds ?? [...DEFAULT_KINDS]
      // What another window's check under way at the removal wrote back is not the first look's baseline.
      await $.store.delete(`${SHARED_SEEN_PREFIX}${repoSeenKey(named)}`)
      await writeRepo($, repoKey(named), () => ({ kinds: chosen, ...(Number(id) > 0 ? { id: Number(id) } : {}) }))
      // The first look takes what is there as seen, so the notices start from now.
      void check($, ctx)
      const opened = kinds === undefined && (await openPicker($, ctx, repoKey(named), chosen))
      return t.registered(repoName(named), kindList(t, chosen), opened)
    }
    case "set": {
      if (kinds === undefined) {
        const opened = await openPicker($, ctx, key, entry?.kinds ?? [])
        return opened ? t.chooseInPane : t.paneNotOpenedForKinds(shown)
      }
      const chosen = kinds
      await writeRepo($, key, held => held && { ...held, kinds: chosen })
      return `${shown}: ${kindList(t, chosen)}`
    }
    case "remove": {
      // A check under way would write back what is removed here.
      while (ctx.running !== undefined) await ctx.running
      await writeRepo($, key, () => undefined)
      await $.store.delete(`${REPO_CACHE_PREFIX}${key}`)
      await $.store.delete(`${TITLES_PREFIX}${key}`)
      await $.store.delete(`${SHARED_SEEN_PREFIX}${repoSeenKey(refOfKey(key))}`)
      await update($, seenIds, ({ [repoSeenKey(refOfKey(key))]: _, ...others }) => others)
      ctx.repoErrors.delete(key)
      return t.removed(shown)
    }
    default: {
      const alias = words.slice(2).join(" ")
      await writeRepo($, key, held => {
        if (held === undefined) return undefined
        const { alias: _, ...rest } = held
        return alias === "" ? rest : { ...rest, alias }
      })
      return alias === "" ? t.aliasCleared(shown) : t.aliasSet(shown, alias)
    }
  }
}

/** The repository open in this window, as `gh` resolves it; null outside one, or with no `gh`. */
async function hereRepo($: EngineInterface) {
  const run = await $.process.run(["gh", "repo", "view", "--json", "url", "--jq", ".url"]).catch(() => undefined)
  return run?.exitCode === 0 ? parseRepo(run.stdout.trim()) : null
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Shows what the pull request holds now in the pick pane, what is staged from it chosen already. */
async function loadItems($: EngineInterface, ctx: Context, ref: PullRef) {
  ctx.picking += 1
  const token = ctx.picking
  await update($, pick, (): GhPick => ({ stage: "loading", message: ctx.t.loadingPull(pullName(ref)) }))
  let shown: GhPick
  try {
    const run = await $.process.run(pickArgv(ref))
    if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || ctx.t.exitedWith("gh api", run.exitCode))
    const picked = parsePicked(ref, run.stdout, toNicknames(await $.store.get(NICKNAMES_KEY)), ctx.language)
    // Keyed as GitHub spells it, whatever case was typed, so a pull request is staged once.
    const key = pullKeyOfUrl(picked.url, ref)
    const held = (await read($, staged)).find(one => one.pull === key)
    const ids = new Set(picked.items.map(item => item.id))
    const chosen = (held?.items ?? []).map(item => item.id).filter(id => ids.has(id))
    shown = { stage: "items", pull: key, ...picked, chosen }
  } catch (error) {
    shown = { stage: "error", message: ctx.t.cannotRead(pullName(ref), message(error)) }
  }
  if (token === ctx.picking) await update($, pick, () => shown)
}

/** Lists in the pick pane the open pull requests of this repository and those of the registered ones the person is involved in. */
/** Lists pull requests to choose from; `failure` says why the branch's own could not be looked up. */
async function loadPulls($: EngineInterface, ctx: Context, failure?: string) {
  ctx.picking += 1
  const token = ctx.picking
  const { t } = ctx
  await update($, pick, (): GhPick => ({ stage: "loading", message: t.searchingPulls }))
  let shown: GhPick
  try {
    const here = await hereRepo($)
    const registered = Object.keys(toRepos(await $.store.get(REPOS_KEY)))
      .map(refOfKey)
      .filter(ref => here === null || repoKey(ref).toLowerCase() !== repoKey(here).toLowerCase())
    const hosts = [...new Set([...(here === null ? [] : [here.host]), ...registered.map(ref => ref.host)])]
    const pulls: GhPickPull[] = []
    const notes: string[] = []
    const errors: string[] = failure === undefined ? [] : [failure]
    for (const host of hosts) {
      const argv = pullsArgv(host, here?.host === host ? here : null, registered.filter(ref => ref.host === host))
      if (argv === null) continue
      try {
        const run = await $.process.run(argv)
        if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || t.exitedWith("gh api", run.exitCode))
        const found = parsePulls(run.stdout, ctx.language)
        pulls.push(...found.pulls.filter(pull => !pulls.some(one => one.key === pull.key)))
        notes.push(...found.notes)
      } catch (error) {
        errors.push(`${host}: ${message(error)}`)
      }
    }
    shown = pulls.length === 0 && errors.length > 0 ? { stage: "error", message: t.searchFailed(errors.join(" / ")) } : { stage: "pulls", pulls, notes: [...errors.map(t.notSearched), ...notes] }
  } catch (error) {
    shown = { stage: "error", message: t.searchFailed(message(error)) }
  }
  if (token === ctx.picking) await update($, pick, () => shown)
}

async function pickCommand($: EngineInterface, ctx: Context, words: readonly string[]): Promise<string> {
  const arg = words.join(" ")
  let ref: PullRef | null = null
  let failure: string | undefined
  if (arg !== "") {
    const isBare = /^#?\d+$/.test(arg)
    ref = parsePullArg(arg, isBare ? await hereRepo($) : null)
    if (ref === null)
      return isBare ? ctx.t.noHereRepo : ctx.t.pullFormat
  } else {
    const branch = await currentBranch($)
    const now = await $.clock.now()
    if (branch !== null && ctx.found?.branch === branch) ref = ctx.found.ref
    else if (branch !== null)
      // A branch with no pull request is not a failure; anything else is said above the list.
      ref = await lookUp($, ctx, branch, now).then(
        found => found.ref,
        error => {
          failure = ctx.t.branchPullFailed(branch, message(error))
          return null
        },
      )
  }
  if (!(await openPick($, ctx, ref, failure))) return ctx.t.paneNotOpened

  return ctx.t.pickOpened
}

/** Opens the pick pane on the pull request's items, or on the list of pull requests when there is none. */
async function openPick($: EngineInterface, ctx: Context, ref: PullRef | null, failure?: string) {
  await update($, pick, (): GhPick => ({ stage: "loading", message: ctx.t.loading }))
  const opened = await $.ui.open({ id: PICK_PANE, title: ctx.t.pickTitle, focus: true })
  if (!opened.isPlaced) return false
  await (ref === null ? loadPulls($, ctx, failure) : loadItems($, ctx, ref))

  return true
}

/** Turns one item of the pick pane on or off: a review with its threads. */
async function toggleItem($: EngineInterface, id: string) {
  await update($, pick, held => {
    if (held?.stage !== "items") return held
    const ids = idsOf(held.items, id)
    // A review chosen with every thread is taken off whole; chosen in part, it is chosen whole.
    const isWhole = ids.every(one => held.chosen.includes(one))
    const chosen = isWhole ? held.chosen.filter(one => !ids.includes(one)) : [...new Set([...held.chosen, ...ids])]
    return { ...held, chosen }
  })
}

/** Stages the pick pane's chosen items in place of what was staged from that pull request. */
async function stageChosen($: EngineInterface, ctx: Context) {
  const held = await read($, pick)
  if (held?.stage !== "items") return
  const items = held.items.filter(item => held.chosen.includes(item.id))
  await update($, staged, list => [
    ...list.filter(one => one.pull !== held.pull),
    ...(items.length === 0 ? [] : [{ pull: held.pull, title: held.title, url: held.url, head: held.head, items, language: ctx.language }]),
  ])
  await $.ui.close({ id: PICK_PANE })
}

// A host other than github.com is named, so the same owner/repo#N on two hosts is told apart.
const pullLabel = (key: string) => {
  const ref = refOfPullKey(key)
  return ref === null ? key : `${ref.host === "github.com" ? "" : `${ref.host}/`}${pullName(ref)}`
}

export const register: Register = (on, options) => {
  const language = toLanguage(options.language)
  const t = MESSAGES[language]
  const ctx: Context = {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, Number(options.intervalSeconds) || 60),
    maxRepos: Math.max(1, Number(options.maxRepos) || 20),
    channel: String(options.channel),
    notifySelf: options.notifySelf === true,
    language,
    t,
    found: undefined,
    running: undefined,
    checks: 0,
    sessionId: "",
    activeAt: 0,
    touchedAt: 0,
    viewers: new Map(),
    repoErrors: new Map(),
    retries: new Map(),
    toggling: Promise.resolve(),
    picking: 0,
    isEnded: false,
  }
  let timer: Timer | undefined

  // `$.inbox.notify` hands a notice back as the hooks on `inbox.notify` let it through, for another mod to act before it shows;
  // `$.inbox.notified` is the hooks' answer told, for another mod to act on what shows.
  on("engine.create", async ($, e, next) => {
    const built = await next(e)
    const inbox: Inbox = { notify: async notice => notice, notified: async () => undefined }
    return { ...built, inbox }
  })

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: t.commandDescription,
      argumentHint: t.commandHint,
    })
    ctx.sessionId = await $.session.id()
    ctx.isEnded = false
    const now = await $.clock.now()
    await tidy($, now)
    // Notices a session listed before they were shared are shared as it opens again.
    await writeHistory($, ctx, now)
    // A reload keeps the session's last touch; a new session counts as touched as it opens.
    ctx.activeAt = toPresence(await $.store.get(presenceKey(ctx)))?.activeAt ?? now
    await touch($, ctx, false)

    timer?.cancel()
    timer = $.clock.every(ctx.intervalSeconds * 1000, () => void check($, ctx))
    void check($, ctx)

    return next(e)
  })

  on("session.end", async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    ctx.isEnded = true
    if (ctx.sessionId !== "") await $.store.delete(presenceKey(ctx))

    return next(e)
  })

  on("prompt.edit", async ($, e, next) => {
    // Every burst of keys passes here: the clock is read without a call on `$`.
    if (Date.now() - ctx.touchedAt >= TOUCH_MS) void touch($, ctx, true).catch(() => undefined)

    return next(e)
  })

  on("prompt.submit", async ($, e, next) => {
    void touch($, ctx, true).catch(() => undefined)
    // What is staged goes with the next prompt the person sends, not with a command or a prompt of a plugin's.
    const isPersons = (e.origin.kind === "composer" || e.origin.kind === "bridge") && e.command === undefined && e.isMeta !== true
    if (!isPersons) return next(e)
    // Taken at once, so a second prompt sent meanwhile does not carry it too; put back when this one does not go.
    let held: GhStaged[] = []
    await update($, staged, list => {
      held = list
      return []
    })
    if (held.length === 0) return next(e)
    const putBack = () => update($, staged, list => [...held.filter(one => !list.some(other => other.pull === one.pull)), ...list])
    try {
      const result = await next({ ...e, context: [...(e.context ?? []), ...stagedContext(held, ctx.language)] })
      if (result.drop !== undefined) await putBack()
      return result
    } catch (error) {
      await putBack()
      throw error
    }
  })

  on("command.run", { command: COMMAND }, async ($, e) => {
    await touch($, ctx, true).catch(() => undefined)
    const [action = "status", ...rest] = e.args.trim().split(/\s+/).filter(word => word !== "")

    switch (action) {
      case "status":
        return { text: await status($, ctx) }
      case "check":
        await check($, ctx, true)
        return { text: await status($, ctx) }
      case "log": {
        const list = latest(await readHistory($), LOG_SHOWN)
        if (list.length === 0) return { text: t.noLog }
        const now = await $.clock.now()
        const when = (event: GhEvent) => {
          const at = Date.parse(event.at)
          return Number.isNaN(at) ? "" : t.paren(ago(t, now - at))
        }
        return { text: logText(list.map(event => ({ text: plain(event.text), url: plain(event.url), when: when(event) }))) }
      }
      case "repo":
        return { text: await repoCommand($, ctx, rest) }
      case "pick":
        return { text: await pickCommand($, ctx, rest) }
      case "clear": {
        const count = stagedCount(await read($, staged))
        await update($, staged, () => [])
        return { text: count === 0 ? t.nothingStaged : t.cleared(count) }
      }
      case "nick": {
        const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
        const [account, ...words] = rest
        if (account === undefined) {
          const entries = Object.entries(nicknames)
          if (entries.length === 0) return { text: t.noNicknames }
          return { text: entries.map(([name, nick]) => `${name} → ${nick}`).join("\n") }
        }
        const nickname = words.join(" ")
        if (nickname === "") {
          if (!(account in nicknames)) return { text: t.noNickname(account) }
          const { [account]: _, ...others } = nicknames
          await $.store.set(NICKNAMES_KEY, others)
          return { text: t.nicknameCleared(account) }
        }
        await $.store.set(NICKNAMES_KEY, { ...nicknames, [account]: nickname })
        return { text: t.nicknameSet(account, displayName(account, { [account]: nickname }, language)) }
      }
      default:
        return { text: t.usage }
    }
  })

  // `/inbox log`'s row draws each notice as a link to it; the text, URLs written out, is what the model reads.
  on("ui.render", { component: "CommandOutput", props: { command: COMMAND } }, async ($, e, next) => {
    const isLog = e.props.args.trim().split(/\s+/)[0] === "log"
    const rows = isLog && !e.props.isErrored ? parseLog(e.props.text) : undefined
    if (rows === undefined) return next(e)
    const { Box, Text, Link } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text>
            {row.url === "" ? row.text : <Link href={row.url}>{row.text}</Link>}
            {row.when === "" ? null : <Text dimColor>{row.when}</Text>}
          </Text>
        ))}
      </Box>
    )
  })

  on("ui.render", { component: "Pane", requestId: PICKER_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, picker)
    if (held === null) return <Text dimColor>{t.noRepoChosen}</Text>
    const kinds = held.kinds.filter(isKind)

    return (
      <Box flexDirection="column">
        <Text>{t.pickerHint(repoName(refOfKey(held.repo)))}</Text>
        {KINDS.map((kind, index) => (
          <Button
            key={kind}
            hotkey={String(index + 1)}
            plain
            label={`[${kinds.includes(kind) ? "x" : " "}] ${t.kinds[kind]}${t.paren(kind)}`}
            onPress={() => {
              // Keys pressed in a row each read what the one before saved.
              ctx.toggling = ctx.toggling.then(() => toggleKind($, kind)).catch(() => undefined)
            }}
          />
        ))}
        <Button label={t.close} onPress={() => void $.ui.close({ id: PICKER_PANE })} />
      </Box>
    )
  })

  on("ui.render", { component: "Pane", requestId: PICK_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, pick)
    const close = <Button key="close" hotkey="q" label={t.close} onPress={() => void $.ui.close({ id: PICK_PANE })} />
    const toPulls = <Button key="pulls" hotkey="p" label={t.otherPull} onPress={() => void loadPulls($, ctx)} />
    if (held === null || held.stage === "loading")
      return (
        <Box flexDirection="column">
          <Text dimColor>{held?.message ?? t.loading}</Text>
          {close}
        </Box>
      )
    if (held.stage === "error")
      return (
        <Box flexDirection="column">
          <Text>{plain(held.message)}</Text>
          {toPulls}
          {close}
        </Box>
      )
    if (held.stage === "pulls")
      return (
        <Box flexDirection="column">
          <Text>
            {held.pulls.length === 0 ? t.noPulls : t.choosePull}
          </Text>
          {held.notes.map(note => (
            <Text key={note} color="warning">
              {plain(note)}
            </Text>
          ))}
          {held.pulls.map((pull, index) => (
            <Button
              key={pull.key}
              hotkey={index < 9 ? String(index + 1) : undefined}
              plain
              label={`${plain(pullLabel(pull.key))} ${plain(pull.title)}${pull.author === null ? "" : t.paren(plain(pull.author))}`}
              onPress={() => {
                const ref = refOfPullKey(pull.key)
                if (ref !== null) void loadItems($, ctx, ref)
              }}
            />
          ))}
          {close}
        </Box>
      )

    return (
      <Box flexDirection="column">
        <Text>
          {plain(pullLabel(held.pull))} {plain(held.title)}
        </Text>
        {held.notes.map(note => (
          <Text key={note} dimColor>
            {note}
          </Text>
        ))}
        <Text dimColor>
          {held.items.length === 0 ? t.noItems : t.itemsHint}
        </Text>
        {held.items.map((item, index) => {
          // A review shows whether it is chosen with all its threads, in part, or not at all.
          const ids = idsOf(held.items, item.id)
          const count = ids.filter(id => held.chosen.includes(id)).length
          const mark = count === ids.length ? "x" : count > 0 ? "-" : " "
          return (
            <Box key={`row:${item.id}`} paddingLeft={item.parent === undefined ? 0 : 4}>
              <Button
                key={item.id}
                hotkey={index < 9 ? String(index + 1) : undefined}
                plain
                label={`[${mark}] ${plain(item.label)}`}
                onPress={() => {
                  // Keys pressed in a row each read what the one before wrote.
                  ctx.toggling = ctx.toggling.then(() => toggleItem($, item.id)).catch(() => undefined)
                }}
              />
            </Box>
          )
        })}
        <Button
          key="stage"
          hotkey="a"
          label={t.attach(held.chosen.length)}
          onPress={() => {
            // After the toggles pressed before it, so it stages what they chose.
            ctx.toggling = ctx.toggling.then(() => stageChosen($, ctx)).catch(() => undefined)
          }}
        />
        {toPulls}
        {close}
      </Box>
    )
  })

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const held = await read($, staged)
    if (e.props.hasSurvey || held.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const what = held.map(one => t.stagedOf(plain(pullLabel(one.pull)), one.items.length)).join(t.listSeparator)
    const size = stagedSize(held, ctx.language)
    // What the other mods draw stays, under this.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Text>{t.staged(what)}</Text>
        {size > CONTEXT_LIMIT && <Text color="warning">{t.oversize(Math.round(size / 1000), CONTEXT_LIMIT / 1000)}</Text>}
        <Box>
          <Button key="gh-inbox-repick" label={t.repick} onPress={() => void openPick($, ctx, refOfPullKey(held[0]?.pull ?? ""))} />
          <Button key="gh-inbox-clear" label={t.detach} onPress={() => void update($, staged, () => [])} />
        </Box>
        {below}
      </Box>
    )
  })
}
