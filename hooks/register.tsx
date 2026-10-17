import { atom, read, update } from "claude-code"
import type { EngineInterface, Register, Timer } from "claude-code"

import type { GhEvent, GhPicker, GhWatch } from "../types"

import { displayName, mergeSeen, newEvents, type Nicknames, plain, pullIds } from "./events"
import { type PullRef, type PullState, parsePull, parsePullUrl, pullArgv, pullName } from "./github"
import { PRESENCE_PREFIX, type Presence, pickActive, toPresence } from "./presence"
import {
  ACTIONS_PRIMED,
  canCompare,
  compareArgv,
  DEFAULT_KINDS,
  eventsArgv,
  isKind,
  jobsArgv,
  KIND_LABELS,
  KINDS,
  type Kind,
  newRepoEvents,
  numbersNeedingTitles,
  numbersNotFound,
  PUSHES_LOOKED_UP,
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
// Titles asked for in one GraphQL request at most.
const TITLES_AT_ONCE = 50
// A lookup that fails for now (no network, a rate limit) is tried at this many checks, its notice held meanwhile.
const LOOKUP_TRIES = 3

const events = atom({ plugin: "gh-inbox", key: "events" } as const, [] as GhEvent[])
const watch = atom({ plugin: "gh-inbox", key: "watch" } as const, null as GhWatch | null)
const seenIds = atom({ plugin: "gh-inbox", key: "seen" } as const, {} as Record<string, string[]>)
const picker = atom({ plugin: "gh-inbox", key: "picker" } as const, null as GhPicker | null)

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
}

const pullKey = (ref: PullRef) => `${ref.host}/${pullName(ref)}`
const presenceKey = (ctx: Context) => `${PRESENCE_PREFIX}${ctx.sessionId}`
const staleMs = (ctx: Context) => STALE_INTERVALS * ctx.intervalSeconds * 1000

function toNicknames(value: unknown): Nicknames {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

const firstLine = (text: string) => text.trim().split("\n")[0] ?? ""

function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}秒前` : `${Math.round(seconds / 60)}分前`
}

async function currentBranch($: EngineInterface) {
  const { exitCode, stdout } = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
  const branch = stdout.trim()
  return exitCode === 0 && branch !== "" && branch !== "HEAD" ? branch : null
}

async function lookUp($: EngineInterface, branch: string, now: number): Promise<Found> {
  const { exitCode, stdout, stderr } = await $.process.run(["gh", "pr", "view", "--json", "url,state"])
  if (exitCode !== 0) {
    if (/no (?:open )?pull requests? found/i.test(stderr)) return { branch, ref: null, state: null, lookedAt: now, isDone: false }
    throw new Error(firstLine(stderr) || `gh pr view exited with ${exitCode}`)
  }
  const answer = JSON.parse(stdout) as { url?: string; state?: PullState }
  const ref = parsePullUrl(answer.url ?? "")

  return { branch, ref, state: answer.state ?? null, lookedAt: now, isDone: false }
}

async function show($: EngineInterface, ctx: Context, list: readonly GhEvent[]) {
  const shown = list.length > SHOWN_AT_ONCE ? [...list.slice(0, SHOWN_AT_ONCE - 1)] : list
  const lines = shown.map(event => plain(event.text))
  if (shown.length < list.length) lines.push(`GitHub: ほか${list.length - shown.length}件の更新があります（/inbox log）`)
  for (const line of lines) {
    if (ctx.channel === "log") $.ui.log(`GitHub: ${line}`)
    else if (ctx.channel === "notify") {
      const sent = await $.ui.notify(line, { title: "GitHub" }).catch(() => ({ isSent: false }))
      if (!sent.isSent) $.ui.toast(line, { timeoutMs: TOAST_MS })
    } else $.ui.toast(line, { timeoutMs: TOAST_MS })
  }
}

/** Writes this session's presence: touched now when `isTouch`, alive now either way. */
async function touch($: EngineInterface, ctx: Context, isTouch: boolean) {
  if (ctx.sessionId === "") return
  const now = await $.clock.now()
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

/** Removes what sessions that never ended cleanly left behind. */
async function tidy($: EngineInterface, now: number) {
  const repos = toRepos(await $.store.get(REPOS_KEY))
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
    } else if (key.startsWith(TITLES_PREFIX)) {
      if (!(key.slice(TITLES_PREFIX.length) in repos)) await $.store.delete(key)
    } else if (key.startsWith("seen:")) {
      // Seen ids were shared by every session before 0.1.0 was released; each session keeps its own now.
      await $.store.delete(key)
    }
  }
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
    if (typeof at === "number" && typeof text === "string" && now - at < ctx.intervalSeconds * 1000) return parsePull(ref, text)
  }
  const fetched = await $.process.run(pullArgv(ref))
  if (fetched.exitCode !== 0) throw new Error(firstLine(fetched.stderr) || `gh api exited with ${fetched.exitCode}`)
  const pull = parsePull(ref, fetched.stdout)
  await $.store.set(key, { at: now, text: fetched.stdout })

  return pull
}

/** Checks the branch's pull request; its notices go to `fresh`. */
async function checkPull($: EngineInterface, ctx: Context, fresh: GhEvent[], isForced: boolean) {
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
      ctx.found = await lookUp($, branch, now)
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
    const seen = seenForPull(seenByKey, ref)
    const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
    fresh.push(...newEvents(pull, seen, { nicknames, notifySelf: ctx.notifySelf }))
    await update($, seenIds, held => ({ ...held, [key]: mergeSeen(held[key] ?? [], pullIds(pull)) }))

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
    if (seen === undefined && pull.state === "OPEN" && (await isShowing($, ctx, now)))
      $.ui.toast(`GitHub: #${ref.number} の通知を始めます。${plain(pull.title)}`, { timeoutMs: TOAST_MS })
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
async function ask($: EngineInterface, argv: string[]): Promise<Response> {
  const run = await $.process.run(argv)
  const response = parseResponse(run.stdout)
  if (response.status === 304) return response
  if (run.exitCode !== 0 || response.status !== 200)
    throw new Error(firstLine(run.stderr) || `GitHub answered ${response.status || `with exit code ${run.exitCode}`}`)

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
async function fetchRepo($: EngineInterface, ctx: Context, ref: RepoRef, kinds: readonly Kind[], now: number): Promise<RepoCache> {
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
    const answer = await ask($, eventsArgv(ref, next.etag || null))
    if (answer.status === 200) next = { ...next, etag: answer.headers.etag ?? null, events: parseEvents(answer.body) }
    next = { ...next, at: now, poll: Number(answer.headers["x-poll-interval"]) || next.poll }
  }
  if (wantsRuns) {
    // Runs that cannot be read (Actions turned off, a token without `actions:read`) do not stop the events.
    try {
      const answer = await ask($, runsArgv(ref, next.runsEtag || null))
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
  for (const one of runs.filter(run => run.failure === undefined)) {
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

/** Checks one registered repository; its notices are returned. */
async function checkRepo($: EngineInterface, ctx: Context, key: string, entry: RepoEntry, nicknames: Nicknames, now: number) {
  const ref = refOfKey(key)
  let cache = await fetchRepo($, ctx, ref, entry.kinds, now)
  const seenKey = repoSeenKey(ref)
  const { value: seenByKey = {} } = await $.state.get({ plugin: "gh-inbox", key: "seen" })
  const seen = seenForRepo(seenByKey, ref)
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
    if (viewer === "") throw new Error("the login gh uses is not known")
    const pending = pendingEvents({ kinds: entry.kinds, events: cache.events, viewer }, seen, ctx.notifySelf)
    const isPrimed = entry.kinds.includes("ci-failure") && seen.has(ACTIONS_PRIMED)
    const failedRuns = isPrimed ? cache.runs.filter(run => !seen.has(run.id) && run.headSha !== watchedHead) : []
    ;({ cache, deferred } = await lookUpDetails($, ctx, ref, cache, pending, failedRuns))
    titles = await titlesFor($, ref, pending)
  }
  // What waits for a lookup is neither notified nor taken as seen yet.
  const events = cache.events.filter(event => !deferred.has(event.id))
  const runs = cache.runs.filter(run => !deferred.has(run.id))
  const fresh = newRepoEvents(
    { ref, label: repoLabel(key, entry), kinds: entry.kinds, events, runs, titles, viewer, watchedHead },
    seen,
    { nicknames, notifySelf: ctx.notifySelf },
  )
  // Ids of every kind are kept, so a kind chosen later does not bring back old events.
  const wantsRuns = entry.kinds.includes("ci-failure") && cache.runsEtag !== null
  const ids = repoIds(events, runs, wantsRuns)
  await update($, seenIds, held => ({
    ...held,
    // Not choosing `ci-failure` drops the mark, so choosing it again starts from the runs there by then.
    [seenKey]: mergeSeen((held[seenKey] ?? []).filter(id => wantsRuns || id !== ACTIONS_PRIMED), ids),
  }))

  return fresh
}

/** Checks every registered repository; their notices go to `fresh`. */
async function checkRepos($: EngineInterface, ctx: Context, fresh: GhEvent[]) {
  const repos = Object.entries(toRepos(await $.store.get(REPOS_KEY))).slice(0, ctx.maxRepos)
  if (repos.length === 0) return
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  const now = await $.clock.now()
  for (const [key, entry] of repos) {
    ctx.repoErrors.delete(key)
    // With no kind chosen GitHub is not asked; chosen again, the repository starts over from a first look.
    if (entry.kinds.length === 0) {
      await update($, seenIds, ({ [repoSeenKey(refOfKey(key))]: _, ...others }) => others)
      continue
    }
    try {
      fresh.push(...(await checkRepo($, ctx, key, entry, nicknames, now)))
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
    const fresh: GhEvent[] = []
    await checkPull($, ctx, fresh, isForced)
    await checkRepos($, ctx, fresh)
    await touch($, ctx, false)
    if (fresh.length === 0) return
    await update($, events, list => [...list, ...fresh].slice(-EVENTS_KEPT))
    // Every session lists the notices; only the one touched last shows them.
    if (await isShowing($, ctx, await $.clock.now())) await show($, ctx, fresh)
  } catch (error) {
    $.ui.log(`gh-inbox: ${error instanceof Error ? error.message : String(error)}`, { to: "debug" })
  } finally {
    ctx.running = undefined
  }
}

async function status($: EngineInterface, ctx: Context) {
  const { value: held } = await $.state.get({ plugin: "gh-inbox", key: "watch" })
  const now = await $.clock.now()
  const lines: string[] = []
  if (held === undefined || held === null || held.branch === null) lines.push("ブランチが分かりません（git リポジトリの外か、detached HEAD です）。")
  else if (held.pull === null) lines.push(`${held.branch} の PR はありません。`)
  else lines.push(`${held.pull} ${held.title ?? ""}（${held.state === "OPEN" ? "通知中" : held.state === "MERGED" ? "マージ済み" : "クローズ済み"}）`)
  if (held?.checkedAt != null) lines.push(`最後の確認: ${ago(now - held.checkedAt)}、${ctx.intervalSeconds}秒ごとに確認します。`)
  if (held?.error != null) lines.push(`エラー: ${held.error}`)
  const repos = Object.keys(toRepos(await $.store.get(REPOS_KEY))).length
  if (repos > 0) lines.push(`登録したリポジトリ: ${repos}件（/inbox repo）`)
  lines.push((await isShowing($, ctx, now)) ? "通知はこの窓に出します。" : "通知は最後に操作した別の窓に出します（/inbox log で一覧を見られます）。")

  return lines.map(plain).join("\n")
}

const kindList = (kinds: readonly Kind[]) => (kinds.length === 0 ? "なし" : kinds.map(kind => KIND_LABELS[kind]).join("、"))

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

async function openPicker($: EngineInterface, key: string, kinds: readonly Kind[]) {
  await update($, picker, () => ({ repo: key, kinds: [...kinds] }))
  const opened = await $.ui.open({ id: PICKER_PANE, title: `通知する種類: ${repoName(refOfKey(key))}`, focus: true })

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

const REPO_USAGE = [
  "使い方:",
  "  /inbox repo                              登録したリポジトリの一覧",
  "  /inbox repo add owner/repo [種類,...]     登録する（種類を省くと選ぶペインを開く）",
  "  /inbox repo set owner/repo [種類,...]     種類を変える（省くと選ぶペインを開く）",
  "  /inbox repo remove owner/repo            登録を外す",
  "  /inbox repo alias owner/repo [短い名前]   通知の先頭に出す名前（省くと消す）",
  `種類: ${KINDS.join(", ")}`,
].join("\n")

async function repoCommand($: EngineInterface, ctx: Context, words: readonly string[]): Promise<string> {
  const [action, name, value] = words
  const repos = await readRepos($)
  if (action === undefined) {
    const entries = Object.entries(repos)
    if (entries.length === 0) return `登録したリポジトリはありません。\n${REPO_USAGE}`
    const now = await $.clock.now()
    const lines: string[] = []
    for (const [index, [key, entry]] of entries.entries()) {
      const cache = toRepoCache(await $.store.get(`${REPO_CACHE_PREFIX}${key}`))
      const label = entry.alias === undefined ? "" : ` [${entry.alias}]`
      const paused =
        index >= ctx.maxRepos
          ? `（上限${ctx.maxRepos}件を超えたため確認しません）`
          : entry.kinds.length === 0
            ? "（種類を選ぶまで確認しません）"
            : ""
      lines.push(`${repoName(refOfKey(key))}${label}: ${kindList(entry.kinds)}${paused}`)
      if (cache !== undefined) lines.push(`  最後の確認: ${ago(now - cache.at)}`)
      const error = ctx.repoErrors.get(key)
      if (error !== undefined) lines.push(`  エラー: ${plain(error)}`)
    }
    return lines.join("\n")
  }
  if (!["add", "set", "remove", "alias"].includes(action)) return REPO_USAGE
  const ref = name === undefined ? null : parseRepo(name)
  if (ref === null) return `リポジトリは owner/repo の形で指定します。\n${REPO_USAGE}`
  // GitHub tells names apart without case: the repository registered is found whatever the case typed.
  const key = Object.keys(repos).find(one => one.toLowerCase() === repoKey(ref).toLowerCase()) ?? repoKey(ref)
  const shown = repoName(refOfKey(key))
  const entry = repos[key]
  if (action !== "add" && entry === undefined) return `${shown} は登録されていません。`

  let kinds: Kind[] | undefined
  if ((action === "add" || action === "set") && value !== undefined) {
    const parsed = parseKinds(value)
    if (parsed.unknown.length > 0) return `知らない種類です: ${parsed.unknown.join(", ")}\n種類: ${KINDS.join(", ")}`
    kinds = parsed.kinds
  }

  switch (action) {
    case "add": {
      if (entry !== undefined) return `${shown} は登録済みです（${kindList(entry.kinds)}）。種類を変えるには /inbox repo set を使います。`
      if (Object.keys(repos).length >= ctx.maxRepos)
        return `登録できるのは${ctx.maxRepos}件までです（/config の「GitHub: Repositories checked」で変えられます）。`
      const found = await $.process.run(repoArgv(ref))
      if (found.exitCode !== 0) return `${shown} を読めませんでした: ${firstLine(found.stderr) || `gh api exited with ${found.exitCode}`}`
      // Registered as GitHub spells it, the key a pull request's URL gives, so their notices are told once.
      const named = parseRepo(`${ref.host}/${found.stdout.trim()}`) ?? ref
      const held = repos[repoKey(named)]
      if (held !== undefined) return `${repoName(named)} は登録済みです（${kindList(held.kinds)}）。種類を変えるには /inbox repo set を使います。`
      const chosen = kinds ?? [...DEFAULT_KINDS]
      await writeRepo($, repoKey(named), () => ({ kinds: chosen }))
      // The first look takes what is there as seen, so the notices start from now.
      void check($, ctx)
      const opened = kinds === undefined && (await openPicker($, repoKey(named), chosen))
      return `${repoName(named)} を登録しました（${kindList(chosen)}）。${opened ? "ペインで種類を選べます。" : ""}`
    }
    case "set": {
      if (kinds === undefined) {
        const opened = await openPicker($, key, entry?.kinds ?? [])
        return opened ? "ペインで種類を選べます。" : `ペインを開けませんでした。/inbox repo set ${shown} 種類,... で指定します。`
      }
      const chosen = kinds
      await writeRepo($, key, held => held && { ...held, kinds: chosen })
      return `${shown}: ${kindList(chosen)}`
    }
    case "remove": {
      // A check under way would write back what is removed here.
      while (ctx.running !== undefined) await ctx.running
      await writeRepo($, key, () => undefined)
      await $.store.delete(`${REPO_CACHE_PREFIX}${key}`)
      await $.store.delete(`${TITLES_PREFIX}${key}`)
      await update($, seenIds, ({ [repoSeenKey(refOfKey(key))]: _, ...others }) => others)
      ctx.repoErrors.delete(key)
      return `${shown} の登録を外しました。`
    }
    default: {
      const alias = words.slice(2).join(" ")
      await writeRepo($, key, held => held && (alias === "" ? { kinds: held.kinds } : { ...held, alias }))
      return alias === "" ? `${shown} の短い名前を消しました。` : `${shown} の通知は [${alias}] で始めます。`
    }
  }
}

export const register: Register = (on, options) => {
  const ctx: Context = {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, Number(options.intervalSeconds) || 60),
    maxRepos: Math.max(1, Number(options.maxRepos) || 20),
    channel: String(options.channel),
    notifySelf: options.notifySelf === true,
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
  }
  let timer: Timer | undefined

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "GitHub notices for this branch's pull request and registered repositories: status, check now, recent notices, repositories, nicknames",
      argumentHint: "[status|check|log|repo [add|set|remove|alias ...]|nick [login [nickname]]]",
    })
    ctx.sessionId = await $.session.id()
    const now = await $.clock.now()
    await tidy($, now)
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

    return next(e)
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
        const { value: list = [] } = await $.state.get({ plugin: "gh-inbox", key: "events" })
        if (list.length === 0) return { text: "このセッションの通知はまだありません。" }
        return { text: list.slice(-20).map(event => `${plain(event.text)}\n  ${plain(event.url)}`).join("\n") }
      }
      case "repo":
        return { text: await repoCommand($, ctx, rest) }
      case "nick": {
        const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
        const [account, ...words] = rest
        if (account === undefined) {
          const entries = Object.entries(nicknames)
          if (entries.length === 0) return { text: "ニックネームはまだありません。/inbox nick <login> <ニックネーム> で登録します。" }
          return { text: entries.map(([name, nick]) => `${name} → ${nick}`).join("\n") }
        }
        const nickname = words.join(" ")
        if (nickname === "") {
          if (!(account in nicknames)) return { text: `${account} のニックネームはありません。` }
          const { [account]: _, ...others } = nicknames
          await $.store.set(NICKNAMES_KEY, others)
          return { text: `${account} のニックネームを消しました。` }
        }
        await $.store.set(NICKNAMES_KEY, { ...nicknames, [account]: nickname })
        return { text: `${account} は「${displayName(account, { [account]: nickname })}」と表示します。` }
      }
      default:
        return { text: "使い方: /inbox [status|check|log|repo|nick [login [ニックネーム]]]" }
    }
  })

  on("ui.render", { component: "Pane", requestId: PICKER_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, picker)
    if (held === null) return <Text dimColor>リポジトリが選ばれていません。</Text>
    const kinds = held.kinds.filter(isKind)

    return (
      <Box flexDirection="column">
        <Text>{repoName(refOfKey(held.repo))}: 押すとオン・オフが切り替わり、すぐに保存します。</Text>
        {KINDS.map((kind, index) => (
          <Button
            key={kind}
            hotkey={String(index + 1)}
            plain
            label={`[${kinds.includes(kind) ? "x" : " "}] ${KIND_LABELS[kind]}（${kind}）`}
            onPress={() => {
              // Keys pressed in a row each read what the one before saved.
              ctx.toggling = ctx.toggling.then(() => toggleKind($, kind)).catch(() => undefined)
            }}
          />
        ))}
        <Button label="閉じる" onPress={() => void $.ui.close({ id: PICKER_PANE })} />
      </Box>
    )
  })
}
