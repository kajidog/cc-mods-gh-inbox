import { atom, read, update } from "claude-code"
import type { EngineInterface, Register, Timer } from "claude-code"

import type {
  GhAct,
  GhActKind,
  GhEvent,
  GhEventItem,
  GhMine,
  GhMinePull,
  GhPick,
  GhPicker,
  GhPickPull,
  GhPlaced,
  GhPrDetail,
  GhPrFound,
  GhPrHeading,
  GhPullStatus,
  GhStaged,
  GhWatch,
  Inbox,
  InboxNotice,
} from "../types"

import {
  actArgv,
  type MergeSettings,
  type Method,
  methodName,
  parseSettings,
  parseViewerApproval,
  planMerge,
  planReview,
  settingsArgv,
  viewerReviewArgv,
} from "./act"
import { type Ci, CI_ITEM_PREFIX, ciForPrompt, ciKey, isResult } from "./ci"
import { CLOSED_ID, displayName, MERGED_ID, mergeSeen, newEvents, type Nicknames, plain, pullIds, snippet } from "./events"
import { isRefused, type Pull, type PullRef, type PullState, parsePull, parsePullUrl, pullArgv, pullName, VERDICTS_ASKED } from "./github"
import {
  addSharedSeen,
  HISTORIES_KEPT,
  HISTORY_PREFIX,
  findLogRepo,
  latest,
  type LogRepo,
  type LogRow,
  logRepos,
  logText,
  MISSED_PREFIX,
  mergeHistories,
  newestAt,
  parseLog,
  repoOfEvent,
  SHARED_KEPT_MS,
  splitLabel,
  SHARED_SEEN_PREFIX,
  toKept,
  toMissed,
  toSessionHistory,
  toSharedSeen,
  unheld,
} from "./history"
import { type Language, MESSAGES, type Messages, splitNotice, toLanguage } from "./i18n"
import { changeOf, type Latest, type LatestItem, latestArgv, latestKey, latestWanted, parseLatest } from "./latest"
import { type MineGroup, mineArgv, parseMine } from "./mine"
import {
  CONTEXT_LIMIT,
  idsOf,
  parsePicked,
  parsePullArg,
  parsePulls,
  pickArgv,
  shownContext,
  pullKeyOfUrl,
  pullsArgv,
  refOfPullKey,
  stagedContext,
  stagedCount,
  stagedSize,
} from "./pick"
import { cells, fitCells, HEADINGS_AT_ONCE, headingsArgv, headingsWanted, noticedPulls, type PrAction, type PrHeading, parseHeadings, parsePrWords } from "./pr-list"
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
  newestEventAt,
  type Repos,
  refOfKey,
  repoLabel,
  TITLES_PREFIX,
  toRepoCache,
  toRepos,
  toTitles,
} from "./repos"
import {
  byPressing,
  pullStatus,
  standingStatus,
  statusMarks,
  statusParts,
  statusText,
  TRAY_VIEW_KEY,
  TRAY_VIEWS,
  type TrayView,
  toTrayView,
} from "./status"
import { dropDone, findWatched, toWatched, type Watched, WATCHED_KEY, WATCHED_MAX, type WatchedEntry } from "./watched"

const COMMAND = "inbox"
const NICKNAMES_KEY = "nicknames"
const EVENTS_KEPT = 100
const LOG_SHOWN = 20
/** Notices the log pane shows on a page. */
const LOG_PAGE = 10
const SHOWN_AT_ONCE = 5
/** The theme color `/inbox log` draws a repository's short name in. */
const LABEL_COLOR = "suggestion"
/** The theme color `/inbox log` draws who did it and what they did in, bold, set apart from what they said. */
const HEAD_COLOR = "claude"
/** The theme colors `/inbox log` draws a push's or commit's changed line counts in, sign and all. */
const ADDED_COLOR = "success"
const REMOVED_COLOR = "error"
/** The line counts a push or commit notice ends with, as `(+4 −2)`; only those kinds are colored, a comment's own words never. */
const CHANGES = /^(.* \()(\+\d+)( )(−\d+)(\))$/s
const CHANGED_KINDS: ReadonlySet<string> = new Set(["commit", "push"])
/** What joins a notice's head to what follows, or ends a head alone: `: `, `.`, `。`. */
const DETAIL_LEAD = /^\s*(?::|\.|。)?\s*/
/** How far in `/inbox log` draws what was said, under who did what. */
const LOG_INDENT = 2
const TOAST_MS = 8000
/** The rows the `row` channel keeps what to draw for, the newest: one placed before them draws nothing. */
const PLACED_KEPT = 200
// A branch with no open pull request is looked up again this often, not at every check.
const LOOKUP_MS = 5 * 60 * 1000
const MIN_INTERVAL_SECONDS = 30
// A session that has not checked in for this many intervals is taken for gone.
const STALE_INTERVALS = 3
// Typing marks the session touched at most this often.
const TOUCH_MS = 10 * 1000
const CACHE_PREFIX = "cache:"
/** Where every session keeps a host's answer to the search for the person's open pull requests, under `CACHE_PREFIX` so it is tidied alike. */
const MINE_CACHE_PREFIX = `${CACHE_PREFIX}mine:`
/** The pull requests the band above the prompt shows at most in each of its groups. */
const MINE_SHOWN = 5
/** The band's groups, in the order it shows them: those the person opened, then those asked of them to review. */
const MINE_GROUPS: readonly MineGroup[] = ["opened", "requested"]
// Left behind by a session that never ended cleanly.
const PRESENCE_KEPT_MS = 24 * 60 * 60 * 1000
const CACHE_KEPT_MS = 60 * 60 * 1000
const PICKER_PANE = "gh-inbox-kinds"
const LOG_PANE = "gh-inbox-log"
/** The pane of `/inbox pr`: the list of pull requests, or one of them with what can be handed to Claude. */
const PR_PANE = "gh-inbox-pr"
const ACT_PANE = "gh-inbox-act"
/** The pull requests the list of `/inbox pr` shows at most of those the log keeps notices of. */
const NOTICED_SHOWN = 10
/** How far the list of `/inbox pr` sets its rows in under their group's heading. */
const PR_ROW_INDENT = 2
/** How long a merge, a close or a draft toggle may take GitHub. */
const ACT_TIMEOUT_MS = 60 * 1000
// Titles asked for in one GraphQL request at most.
const TITLES_AT_ONCE = 50
// A lookup that fails for now (no network, a rate limit) is tried at this many checks, its notice held meanwhile.
const LOOKUP_TRIES = 3

const events = atom({ plugin: "gh-inbox", key: "events" } as const, [] as GhEvent[])
const watch = atom({ plugin: "gh-inbox", key: "watch" } as const, null as GhWatch | null)
const seenIds = atom({ plugin: "gh-inbox", key: "seen" } as const, {} as Record<string, string[]>)
const picker = atom({ plugin: "gh-inbox", key: "picker" } as const, null as GhPicker | null)
/** What the pull request `/inbox pr` shows holds that can be handed to Claude. */
const pick = atom({ plugin: "gh-inbox", key: "pick" } as const, null as GhPick | null)
const staged = atom({ plugin: "gh-inbox", key: "staged" } as const, [] as GhStaged[])
const logPage = atom({ plugin: "gh-inbox", key: "logPage" } as const, 0)
const logUnfolded = atom({ plugin: "gh-inbox", key: "logUnfolded" } as const, [] as string[])
const logRepo = atom({ plugin: "gh-inbox", key: "logRepo" } as const, null as string | null)
/** What the log pane's comments say now, by `latestKey`, asked for as their page shows. */
const logLatest = atom({ plugin: "gh-inbox", key: "logLatest" } as const, {} as Record<string, Latest>)
const pickUnfolded = atom({ plugin: "gh-inbox", key: "pickUnfolded" } as const, [] as string[])
/** The pull request the pane of `/inbox pr` shows; null while it shows the list. */
const prDetail = atom({ plugin: "gh-inbox", key: "prDetail" } as const, null as GhPrDetail | null)
/** What the list of `/inbox pr` looked for as it opened. */
const prFound = atom({ plugin: "gh-inbox", key: "prFound" } as const, null as GhPrFound | null)
/** What GitHub says of the pull requests the list of `/inbox pr` shows that nothing else tells of, by `host/owner/repo#number`. */
const prHeadings = atom({ plugin: "gh-inbox", key: "prHeadings" } as const, {} as Record<string, GhPrHeading>)
/** When each watched pull request was added, as this session last checked it: added again since, it starts over from a first look. */
const watchedSince = atom({ plugin: "gh-inbox", key: "watchedSince" } as const, {} as Record<string, number>)
/** How CI of the branch's pull request stood when Claude was last told of it in this session: kept across a reload. */
const ciTold = atom({ plugin: "gh-inbox", key: "ciTold" } as const, null as string | null)
/** When what Claude was last told of CI was asked of GitHub: an answer asked for before it is older news, not told. */
const ciToldAt = atom({ plugin: "gh-inbox", key: "ciToldAt" } as const, 0)
/** The rows the `row` channel placed in the transcript, and what each draws. */
const placed = atom({ plugin: "gh-inbox", key: "placed" } as const, [] as GhPlaced[])
/** What the pane that confirms `/inbox pr`'s merge, close, draft, approve or unapprove asks to confirm. */
const act = atom({ plugin: "gh-inbox", key: "act" } as const, null as GhAct | null)
/** The open pull requests the person opened, as the band above the prompt shows them. */
const mine = atom({ plugin: "gh-inbox", key: "mine" } as const, null as GhMine | null)

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
  /** Whether the line under the prompt tells each repository's last event. */
  tray: boolean
  /** Whether a prompt the person sends tells Claude of a result of the branch's pull request's CI it was not told of. */
  ciToClaude: boolean
  /** Whether the band above the prompt shows where the person's open pull requests stand. */
  mine: boolean
  language: Language
  /** What the mod says, in `language`. */
  t: Messages
  found: Found | undefined
  /** The branch the last check read; undefined before the first, null outside a branch. */
  branch: string | null | undefined
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
  /** The last check's error of a watched pull request, by `host/owner/repo#number`. */
  watchErrors: Map<string, string>
  /**
   * The newest commits of the watched pull requests this check asked about, by `host/owner/repo`: their failed
   * checks are told there, so a registered repository does not tell their runs.
   */
  watchHeads: Map<string, Set<string>>
  /** The failed tries of a lookup tried again, by the id of its push or run. */
  retries: Map<string, number>
  /** The picker's toggles, one after another. */
  toggling: Promise<void>
  /** How many loads of a pull request's items `/inbox pr` has started: a load that is no longer the last one is not shown. */
  picking: number
  /** How many times `/inbox pr` has shown a pull request: an answer asked for at one that is no longer the last is not shown. */
  prShowings: number
  /** How many times the list of `/inbox pr` has opened: an answer asked for at an opening that is no longer the last is not shown. */
  prListings: number
  /** Whether the session has ended: a check still under way then does not mark it alive again. */
  isEnded: boolean
  /** The `latestKey`s the log pane has asked for since it opened, answered or not: each is asked once an opening. */
  askedLatest: Set<string>
  /** How many times the log has opened: an answer asked for at an opening that is no longer the last is not shown. */
  logOpenings: number
  /** The `host/owner/repo#number`s whose headings (title, where it stands) the list of `/inbox pr` has asked for since it opened, answered or not. */
  askedHeadings: Set<string>
  /** The open pull request of the branch and its newest commit's CI, as the last check that read it found them. */
  ci: { branch: string; ref: PullRef; title: string; url: string; ci: Ci; at: number } | undefined
  /** Whether what the action pane confirmed is under way: a second press does not send it again. */
  isActing: boolean
  /** Whether what a button of `/inbox pr`'s pull request asked is still asked of GitHub: another press waits for it. */
  isPrPressing: boolean
  /** The hosts that refused a request naming the teams asked to review (a token that may not read them): asked without them since. */
  teamless: Set<string>
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

/** What a log row is drawn by, as its notice was made. */
type LogMade = { who?: string; head?: string; label?: string; kind?: string }
const madeOf = (event: GhEvent): LogMade => ({
  who: event.who === undefined ? undefined : plain(event.who),
  head: event.head === undefined ? undefined : plain(event.head),
  label: event.label === undefined ? undefined : plain(event.label),
  kind: event.kind,
})

/**
 * What a notice said that its line cut short, as the log keeps it; undefined where its line says it all
 * (one short part) or the log kept no words of it (a notice kept before it kept them).
 */
function saidInFull(event: GhEvent): GhEventItem[] | undefined {
  const items = (Array.isArray(event.items) ? event.items : []).filter(item => typeof item.body === "string" && item.body.trim() !== "")
  const [only] = items
  if (only === undefined) return undefined
  if (items.length === 1 && only.path === undefined && !only.body.includes("\n") && snippet(only.body) === only.body.trim()) return undefined
  return items
}

/** `detail` with the line counts it ends with in color, else as it is. */
function changed(detail: string, Text: ReturnType<EngineInterface["ui"]["resolve"]>["Text"]) {
  const match = CHANGES.exec(detail)
  if (match === null) return detail
  const [, before, added, gap, removed, after] = match
  return (
    <Text>
      {before}
      <Text color={ADDED_COLOR}>{added}</Text>
      {gap}
      <Text color={REMOVED_COLOR}>{removed}</Text>
      {after}
    </Text>
  )
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
  const each = final.slice(0, shown.length)
  // The rest are counted on a line of their own, which says "GitHub:" itself.
  const more = shown.length < list.length ? ctx.t.moreUpdates(list.length - shown.length) : undefined
  if (ctx.channel === "row") await placeRows($, each, more)
  else {
    for (const notice of each) await tell($, ctx, notice.text, `GitHub: ${notice.text}`)
    if (more !== undefined) await tell($, ctx, more, more)
  }
  // Told once every hook on `inbox.notify` has answered, so what a hook there does is what shows.
  for (const notice of final) await $.inbox.notified(notice).catch(() => undefined)
}

/** Shows one line on the channel chosen: `logged` is the line as the transcript's dim line says it. */
async function tell($: EngineInterface, ctx: Context, line: string, logged: string) {
  if (ctx.channel === "log") $.ui.log(logged)
  else if (ctx.channel === "notify") {
    const sent = await $.ui.notify(line, { title: "GitHub" }).catch(() => ({ isSent: false }))
    if (!sent.isSent) $.ui.toast(line, { timeoutMs: TOAST_MS })
  } else $.ui.toast(line, { timeoutMs: TOAST_MS })
}

/**
 * Places each notice as a row of its own at the transcript's end, drawn as the log draws it with what was done a
 * link to it on GitHub, and `more`, the rest counted, as a dim one. A row that cannot stand (a Claude Code with no
 * rows yet, before 2.1.312) is the dim line the `log` channel writes instead.
 */
async function placeRows($: EngineInterface, notices: readonly InboxNotice[], more: string | undefined) {
  const now = await $.clock.now()
  const wanted: Array<Omit<GhPlaced, "id">> = [
    ...notices.map(notice => ({ text: notice.text, url: notice.event.url, made: madeOf(notice.event) })),
    ...(more === undefined ? [] : [{ text: more, url: "" }]),
  ]
  let rows: GhPlaced[] = []
  // Kept before the rows are placed, so that a row's first drawing finds what it draws.
  await update($, placed, list => {
    const taken = new Set(list.map(row => row.id))
    let n = 0
    const freeId = () => {
      for (;;) {
        const id = `${now.toString(36)}-${n++}`
        if (!taken.has(id)) return id
      }
    }
    rows = wanted.map(row => ({ id: freeId(), ...row }))
    return [...list, ...rows].slice(-PLACED_KEPT)
  })
  for (const row of rows) {
    if (!(await isPlaced($, row.id))) $.ui.log(row.made === undefined ? row.text : `GitHub: ${row.text}`)
  }
}

/** Places the row `id`: whether it stands, as it does not where this Claude Code places no rows or refused it. */
async function isPlaced($: EngineInterface, id: string) {
  try {
    const result = await $.ui.place({ id })
    // One not drawn now still stands for a surface yet to attach; one with no id does not stand at all.
    return result.isPlaced || result.requestId !== undefined
  } catch {
    return false
  }
}

/**
 * Runs the GraphQL request `argv` makes for `host`, naming the teams asked to review where the host has not refused
 * that: GitHub refusing it, it is asked again without them, and so from then on where that is answered.
 */
async function runNamingTeams($: EngineInterface, ctx: Context, host: string, argv: (teams: boolean) => string[]) {
  const key = host.toLowerCase()
  const teams = !ctx.teamless.has(key)
  const run = await $.process.run(argv(teams))
  if (run.exitCode === 0 || !teams || !isRefused(run.stdout)) return run
  const without = await $.process.run(argv(false))
  if (without.exitCode !== 0) return run
  ctx.teamless.add(key)
  $.ui.log(`gh-inbox: ${host} refused naming the teams asked to review (${firstLine(run.stderr)}); asked without them now`, { to: "debug" })
  return without
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

/**
 * Asks what the comments of `events` (the log pane's page) say now, those not asked for since the pane opened,
 * one request a host; the pane shows them edited or deleted as the answer comes. A failed request is let be.
 */
async function lookUpLatest($: EngineInterface, ctx: Context, events: readonly GhEvent[]) {
  const opening = ctx.logOpenings
  for (const [host, ids] of latestWanted(events, ctx.askedLatest)) {
    for (const id of ids) ctx.askedLatest.add(`${host}|${id}`)
    const run = await $.process.run(latestArgv(host, ids)).catch(() => undefined)
    // A comment deleted fails the request, but the answer still holds the others.
    let latest: Map<string, Latest>
    try {
      latest = parseLatest(host, ids, run?.stdout ?? "")
    } catch {
      $.ui.log(`gh-inbox: comments of ${host}: ${firstLine(run?.stderr ?? "")}`, { to: "debug" })
      continue
    }
    if (opening !== ctx.logOpenings) return
    if (latest.size > 0) await update($, logLatest, held => ({ ...held, ...Object.fromEntries(latest) }))
  }
}

/**
 * Asks the headings of the pull requests `keys` (`host/owner/repo#number`) the list of `/inbox pr` shows that nothing
 * else tells of, those not asked for since the list opened, one request a repository: each one's title, whether it is
 * a pull request, and where it stands now. A failed request is let be: the row shows the title known without asking.
 */
async function lookUpHeadings($: EngineInterface, ctx: Context, keys: readonly string[]) {
  const listing = ctx.prListings
  const wanted = headingsWanted(keys, ctx.askedHeadings)
  if (wanted.size === 0) return
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  // As many as one request asks for at a time: each is taken as asked only as its request goes.
  const batches = [...wanted].flatMap(([repo, all]) =>
    Array.from({ length: Math.ceil(all.length / HEADINGS_AT_ONCE) }, (_, at) => [repo, all.slice(at * HEADINGS_AT_ONCE, (at + 1) * HEADINGS_AT_ONCE)] as const),
  )
  for (const [repo, numbers] of batches) {
    for (const number of numbers) ctx.askedHeadings.add(`${repo}#${number}`)
    // A number GitHub does not know fails the request, but the answer still holds the others.
    const host = repo.slice(0, repo.indexOf("/"))
    const run = await runNamingTeams($, ctx, host, teams => headingsArgv(repo, numbers, teams)).catch(() => undefined)
    let headings: Map<number, PrHeading>
    try {
      headings = parseHeadings(run?.stdout ?? "")
    } catch {
      $.ui.log(`gh-inbox: headings of ${repo}: ${firstLine(run?.stderr ?? "")}`, { to: "debug" })
      continue
    }
    if (listing !== ctx.prListings) return
    if (headings.size === 0) continue
    const read = [...headings].map(([number, heading]): [string, GhPrHeading] => [
      `${repo}#${number}`,
      {
        title: heading.title,
        isPull: heading.pull !== undefined,
        state: heading.pull?.state ?? null,
        status: heading.pull === undefined ? null : standingStatus(heading.pull, nicknames, ctx.language),
      },
    ])
    await update($, prHeadings, held => ({ ...held, ...Object.fromEntries(read) }))
  }
}

/** The title of each of `keys` known without asking GitHub: a watched pull request's, or a registered repository's kept for its notices. */
async function knownTitles($: EngineInterface, keys: readonly string[]): Promise<Map<string, string>> {
  const known = new Map<string, string>()
  const watched = await readWatched($)
  const kept = new Map<string, Titles>()
  for (const key of keys) {
    const ref = refOfPullKey(key)
    if (ref === null) continue
    const repo = repoKey(ref)
    if (!kept.has(repo)) kept.set(repo, toTitles(await $.store.get(`${TITLES_PREFIX}${repo}`)))
    const watchedKey = findWatched(watched, key)
    const title = (watchedKey === undefined ? "" : (watched[watchedKey]?.title ?? "")) || (kept.get(repo)?.[String(ref.number)]?.title ?? "")
    if (title !== "") known.set(key, title)
  }

  return known
}

/** The repositories the log keeps notices of, named by the registered repositories' short names where it can. */
async function readLogRepos($: EngineInterface, history: readonly GhEvent[]): Promise<LogRepo[]> {
  const labels = new Map(Object.entries(await readRepos($)).map(([key, entry]) => [repoName(refOfKey(key)), repoLabel(key, entry)]))
  return logRepos(history, labels)
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

/** The answer to `pullQuery` the store holds for the pull request, and when it was asked, whatever its age; undefined with none. */
async function cachedPull($: EngineInterface, ctx: Context, ref: PullRef): Promise<{ pull: Pull; at: number } | undefined> {
  const cached = await $.store.get(`${CACHE_PREFIX}${pullKey(ref)}`)
  if (typeof cached !== "object" || cached === null) return undefined
  const { at, text } = cached as { at?: unknown; text?: unknown }
  if (typeof at !== "number" || typeof text !== "string") return undefined
  try {
    return { pull: parsePull(ref, text, ctx.language), at }
  } catch {
    return undefined
  }
}

/**
 * The pull request as GitHub answers `pullQuery`, and when it was asked: another
 * session's answer when it is younger than one interval, so sessions watching the
 * same pull request ask GitHub once between them; asked afresh whatever its age when `isFresh`.
 */
async function fetchPull($: EngineInterface, ctx: Context, ref: PullRef, now: number, isFresh = false) {
  const cached = await cachedPull($, ctx, ref)
  if (!isFresh && cached !== undefined && now - cached.at < ctx.intervalSeconds * 1000) return cached
  const fetched = await runNamingTeams($, ctx, ref.host, teams => pullArgv(ref, teams))
  if (fetched.exitCode !== 0) throw new Error(firstLine(fetched.stderr) || ctx.t.exitedWith("gh api", fetched.exitCode))
  const pull = parsePull(ref, fetched.stdout, ctx.language)
  await $.store.set(`${CACHE_PREFIX}${pullKey(ref)}`, { at: now, text: fetched.stdout })

  return { pull, at: now }
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
    ctx.branch = branch
    if (branch === null) {
      ctx.found = undefined
      ctx.ci = undefined
      await update($, watch, () => ({ branch: null, pull: null, title: null, url: null, state: null, checkedAt: null, error: null, status: null }))
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
      ctx.ci = undefined
      await update($, watch, () => ({ branch, pull: null, title: null, url: null, state: null, checkedAt: now, error: null, status: null }))
      return
    }
    if (ctx.found.isDone) {
      ctx.ci = undefined
      return
    }

    const { pull, at } = await fetchPull($, ctx, ref, now)
    ctx.ci =
      pull.state === "OPEN"
        ? { branch, ref, title: pull.title, url: pull.url, ci: { oid: pull.head, state: pull.ciState, checks: pull.checks, total: pull.checksTotal }, at }
        : undefined

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
      // Watched too, its end is marked as a watched one's is, so it leaves the list; no request more.
      await markWatchedDone($, key, pull.state, now)
    }
    await update($, watch, () => ({
      branch,
      pull: pullName(ref),
      title: pull.title,
      url: pull.url,
      state: pull.state,
      checkedAt: now,
      error: null,
      status: pullStatus(pull, nicknames, ctx.language),
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
      status: held?.status ?? null,
    }))
    $.ui.log(`gh-inbox: ${message}`, { to: "debug" })
  }
}

async function readWatched($: EngineInterface) {
  return toWatched(await $.store.get(WATCHED_KEY))
}

/**
 * Changes one watched pull request's entry: read, changed and written at once, as every session writes the same key;
 * the others keep their place.
 */
async function writeWatched($: EngineInterface, key: string, change: (entry: WatchedEntry | undefined) => WatchedEntry | undefined) {
  const watched = await readWatched($)
  const changed = change(watched[key])
  const { [key]: _, ...others } = watched
  const written: Watched = changed === undefined ? others : { ...watched, [key]: changed }
  await $.store.set(WATCHED_KEY, written)
}

/** Whether `key` (`host/owner/repo#number`) is the branch's pull request, which is checked as the branch's. */
const isBranchPull = (ctx: Context, key: string) => ctx.found?.ref != null && pullKey(ctx.found.ref).toLowerCase() === key.toLowerCase()

/** Marks a watched pull request (`key` whatever its case) merged or closed, where it is watched and not marked yet. */
async function markWatchedDone($: EngineInterface, key: string, state: Exclude<PullState, "OPEN">, now: number) {
  const watched = await readWatched($)
  const held = findWatched(watched, key)
  if (held === undefined || watched[held]?.done !== undefined) return
  await writeWatched($, held, one => one && { ...one, done: one.done ?? { state, at: now } })
}

/** What a watched pull request's notices start with in brackets: its repository's short name, registered or not, and its number. */
function watchLabel(repos: Repos, ref: PullRef) {
  const key = Object.keys(repos).find(one => one.toLowerCase() === repoKey(ref).toLowerCase())
  const entry = key === undefined ? undefined : repos[key]
  return `${key === undefined || entry === undefined ? ref.repo : repoLabel(key, entry)}#${ref.number}`
}

/**
 * Checks the pull requests `/inbox pr` watches as the branch's is checked, one GraphQL request each; their notices go
 * to `checked`, their names in brackets in front. One seen merged or closed is asked about no more by a session that
 * told its end or never looked at it, and leaves the list a day after.
 */
async function checkWatched($: EngineInterface, ctx: Context, checked: Checked) {
  ctx.watchHeads = new Map()
  const now = await $.clock.now()
  const held = await readWatched($)
  const kept = dropDone(held, now)
  if (Object.keys(kept).length < Object.keys(held).length) await $.store.set(WATCHED_KEY, kept)
  const entries = Object.entries(kept).slice(0, WATCHED_MAX)
  if (entries.length === 0) return
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  const repos = await readRepos($)
  for (const [key, entry] of entries) {
    ctx.watchErrors.delete(key)
    const ref = refOfPullKey(key)
    if (ref === null) continue
    try {
      // Added again since this session last looked (here or in another window), it starts over from a first look:
      // what came while it was not watched is no news. The branch's own keeps what it has seen, and is taken as looked
      // at, so it goes on from there once the branch is switched away from.
      const since = entry.since ?? 0
      if ((await read($, watchedSince))[key] !== since) {
        if (!isBranchPull(ctx, key)) await update($, seenIds, ({ [key]: _, ...others }) => others)
        await update($, watchedSince, held => ({ ...held, [key]: since }))
      }
      if (isBranchPull(ctx, key)) continue
      const { value: seenByKey = {} } = await $.state.get({ plugin: "gh-inbox", key: "seen" })
      const own = seenForPull(seenByKey, ref)
      if (entry.done !== undefined && (own === undefined || own.has(MERGED_ID) || own.has(CLOSED_ID))) continue
      const { pull } = await fetchPull($, ctx, ref, now)
      // Each session keeps its own seen ids, as for the branch's; those a registered repository's notices took count too.
      const seen = own ?? seenForPull(await sharedSeen($), ref)
      const bucket = checked[await bucketOf($, ctx, own, now)]
      const label = watchLabel(repos, ref)
      for (const event of newEvents(pull, seen, { nicknames, notifySelf: ctx.notifySelf, language: ctx.language })) {
        const text = `[${label}] ${event.text}`
        const isSelf = event.author !== null && event.author === pull.viewer
        bucket.push({ event: { ...event, label, text }, source: "watch", repo: repoKey(ref), label, isSelf, text: plain(text) })
      }
      await update($, seenIds, seenOf => ({ ...seenOf, [key]: mergeSeen(seenOf[key] ?? [], pullIds(pull)) }))
      await shareSeen($, key, pullIds(pull), now)

      const head = pull.commits.at(-1)?.oid
      const repo = repoKey(ref).toLowerCase()
      if (head !== undefined) ctx.watchHeads.set(repo, new Set([...(ctx.watchHeads.get(repo) ?? []), head]))
      // Its end marked once (and unmarked, opened again), so the list can say it and drop it. The shared list is
      // written only then, not at every check, so a check seldom writes over what another window just changed.
      const done = pull.state === "OPEN" ? undefined : (entry.done ?? { state: pull.state, at: now })
      if (done !== entry.done)
        await writeWatched($, key, one => {
          if (one === undefined) return undefined
          const { done: _, ...rest } = one
          return { ...rest, title: pull.title, ...(done === undefined ? {} : { done: one.done ?? done }) }
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.watchErrors.set(key, message)
      $.ui.log(`gh-inbox: ${pullName(ref)}: ${message}`, { to: "debug" })
    }
  }
}

/**
 * The hosts searched for the person's open pull requests: github.com, and those of the registered repositories, the
 * watched pull requests and the branch's.
 */
async function mineHosts($: EngineInterface, ctx: Context): Promise<string[]> {
  const hosts = new Set(["github.com"])
  for (const key of Object.keys(await readRepos($))) hosts.add(refOfKey(key).host.toLowerCase())
  for (const key of Object.keys(await readWatched($))) {
    const ref = refOfPullKey(key)
    if (ref !== null) hosts.add(ref.host.toLowerCase())
  }
  if (ctx.found?.ref != null) hosts.add(ctx.found.ref.host.toLowerCase())

  return [...hosts]
}

/**
 * A host's open pull requests the person opened: another session's answer while it is younger than one interval, so
 * the sessions search once between them; else searched again.
 */
async function fetchMine($: EngineInterface, ctx: Context, host: string, now: number) {
  const key = `${MINE_CACHE_PREFIX}${host}`
  const cached = await $.store.get(key)
  const { at, text } = (typeof cached === "object" && cached !== null ? cached : {}) as { at?: unknown; text?: unknown }
  if (typeof at === "number" && typeof text === "string" && now - at < ctx.intervalSeconds * 1000) {
    try {
      return parseMine(text, ctx.language)
    } catch {
      // Asked again below.
    }
  }
  const run = await runNamingTeams($, ctx, host, teams => mineArgv(host, teams))
  if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || ctx.t.exitedWith("gh api", run.exitCode))
  const found = parseMine(run.stdout, ctx.language)
  await $.store.set(key, { at: now, text: run.stdout })

  return found
}

/**
 * Searches each host for the open pull requests the person opened, the most pressing first, and those asked of them to
 * review, updated last first; a host that cannot be searched for now keeps what `held` had of it.
 */
async function findMine($: EngineInterface, ctx: Context, held: GhMine | null): Promise<GhMine> {
  const now = await $.clock.now()
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  const repos = await readRepos($)
  const groups: Record<MineGroup, { pulls: GhMinePull[]; more: number }> = { opened: { pulls: [], more: 0 }, requested: { pulls: [], more: 0 } }
  for (const host of await mineHosts($, ctx)) {
    try {
      const found = await fetchMine($, ctx, host, now)
      for (const group of MINE_GROUPS) {
        for (const pull of found[group].pulls) {
          const author = pull.author === null ? undefined : displayName(pull.author, nicknames, ctx.language)
          groups[group].pulls.push({
            key: pullKey(pull.ref),
            label: watchLabel(repos, pull.ref),
            title: pull.title,
            url: pull.url,
            updatedAt: pull.updatedAt,
            ...(author === undefined ? {} : { author }),
            status: standingStatus(pull, nicknames, ctx.language),
          })
        }
        groups[group].more += found[group].total - found[group].pulls.length
      }
    } catch (error) {
      for (const group of MINE_GROUPS)
        groups[group].pulls.push(...(held?.[group]?.pulls ?? []).filter(pull => pull.key.toLowerCase().startsWith(`${host}/`)))
      $.ui.log(`gh-inbox: pull requests on ${host}: ${message(error)}`, { to: "debug" })
    }
  }
  // Those the person opened, the most pressing first; those asked of them, as GitHub found them, updated last first.
  const byUpdate = [...groups.requested.pulls].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return {
    opened: { pulls: byPressing(ctx.t, groups.opened.pulls), more: groups.opened.more },
    requested: { pulls: byUpdate, more: groups.requested.more },
    checkedAt: now,
  }
}

/** Searches for the band above the prompt the person's open pull requests and those asked of them. Turned off, the band shows none. */
async function checkMine($: EngineInterface, ctx: Context) {
  if (!ctx.mine) {
    if ((await read($, mine)) !== null) await update($, mine, () => null)
    return
  }
  const found = await findMine($, ctx, await read($, mine))
  await update($, mine, () => found)
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
  // The watched pull requests' failed checks are told there too.
  const watchedHeads = new Set([...(watchedHead === null ? [] : [watchedHead]), ...(ctx.watchHeads.get(key.toLowerCase()) ?? [])])

  let viewer = ""
  let titles: Titles = {}
  let deferred = new Set<string>()
  if (seen !== undefined) {
    viewer = await viewerOf($, ctx, ref.host)
    // Without it the person's own activity would pass for someone else's: the repository waits for the next check.
    if (viewer === "") throw new Error(ctx.t.viewerUnknown)
    const pending = pendingEvents({ kinds: entry.kinds, events: cache.events, viewer }, seen, ctx.notifySelf)
    const isPrimed = entry.kinds.includes("ci-failure") && seen.has(ACTIONS_PRIMED)
    const failedRuns = isPrimed ? cache.runs.filter(run => !seen.has(run.id) && !watchedHeads.has(run.headSha)) : []
    ;({ cache, deferred } = await lookUpDetails($, ctx, ref, cache, pending, failedRuns))
    titles = await titlesFor($, ref, pending)
  }
  // What waits for a lookup is neither notified nor taken as seen yet.
  const events = cache.events.filter(event => !deferred.has(event.id))
  const runs = cache.runs.filter(run => !deferred.has(run.id))
  const label = repoLabel(key, entry)
  const fresh = newRepoEvents(
    { ref, label, kinds: entry.kinds, events, runs, titles, viewer, watchedHeads },
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

/**
 * Checks at once when the branch is no longer the one the last check read: a switch shows by the next prompt sent,
 * not the next tick. Reading the branch asks git alone; GitHub is asked only when it changed.
 */
async function followBranch($: EngineInterface, ctx: Context) {
  if (ctx.branch === undefined) return
  const branch = await currentBranch($)
  if (branch !== ctx.branch) await check($, ctx, true)
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
    // Before the repositories, so what a pull request tells in full is not told by a repository's event first.
    await checkWatched($, ctx, checked)
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
    // After the notices, so the search does not hold them back.
    await checkMine($, ctx).catch(error => $.ui.log(`gh-inbox: ${message(error)}`, { to: "debug" }))
    // Drawn again each check, so how long ago keeps up; also where nothing was shown.
    await drawTray($, ctx).catch(() => undefined)
    ctx.running = undefined
  }
}

/** What the tray says of a time `ms` ago: to the minute, as it is drawn again once a check. */
const trayAgo = (t: Messages, ms: number) => (ms < 60_000 ? t.justNow : ago(t, ms))

/**
 * Where the branch's pull request stands, as the line under the prompt tells it, in parts, `withNames` naming the
 * reviewers; undefined while it has none.
 */
async function pullItems($: EngineInterface, ctx: Context, now: number, sinceAt: (ms: number) => string, withNames = false) {
  const { value: held } = await $.state.get({ plugin: "gh-inbox", key: "watch" })
  const number = Number(/#(\d+)$/.exec(held?.pull ?? "")?.[1])
  if (held === undefined || held === null || !(number > 0)) return undefined
  return statusParts(
    ctx.t,
    number,
    held.state,
    held.status,
    at => {
      const ms = Date.parse(at)
      return Number.isNaN(ms) ? undefined : sinceAt(now - ms)
    },
    withNames,
  )
}

/**
 * The line under the prompt: where the branch's pull request stands, or how long ago each repository checked had its
 * last event, as `/inbox tray` chose; the other where the one chosen has nothing to tell, none where neither has.
 */
async function drawTray($: EngineInterface, ctx: Context) {
  const { t } = ctx
  const repos = Object.entries(await readRepos($))
    .slice(0, ctx.maxRepos)
    .filter(([, entry]) => entry.kinds.length > 0)
  if (ctx.isEnded) return
  if (!ctx.tray) return $.ui.status(undefined)
  const now = await $.clock.now()
  const view = toTrayView(await $.store.get(TRAY_VIEW_KEY))
  const pull = await pullItems($, ctx, now, ms => trayAgo(t, ms))
  let items: string[] | undefined
  if (repos.length > 0 && (view === "repos" || pull === undefined)) {
    items = []
    for (const [key, entry] of repos) {
      const cache = toRepoCache(await $.store.get(`${REPO_CACHE_PREFIX}${key}`))
      const at = cache === undefined ? undefined : newestEventAt(cache)
      items.push(t.trayItem(repoLabel(key, entry), at === undefined ? t.trayNoEvent : trayAgo(t, now - at)))
    }
  } else items = pull === undefined ? undefined : [statusText(pull)]
  // The session may have ended while the store was read: its line is not drawn again.
  if (!ctx.isEnded) $.ui.status(items === undefined ? undefined : plain(t.tray(items)))
}

/** Chooses what the line under the prompt shows: `words` names it, or else it switches to the other. */
async function trayCommand($: EngineInterface, ctx: Context, words: readonly string[]) {
  const { t } = ctx
  const [named] = words
  if (named !== undefined && !TRAY_VIEWS.includes(named as TrayView)) return t.trayUsage
  const view: TrayView = (named as TrayView | undefined) ?? (toTrayView(await $.store.get(TRAY_VIEW_KEY)) === "pull" ? "repos" : "pull")
  await $.store.set(TRAY_VIEW_KEY, view)
  await drawTray($, ctx)

  return ctx.tray ? t.trayShows(view) : t.trayOff
}

/** What `/inbox` says after a pull request's title: whether it is a draft, and merged or closed; nothing else of an open one. */
function stateOf(t: Messages, state: string | null, isDraft: boolean) {
  const said = [...(isDraft ? [t.draft] : []), ...(state === "OPEN" ? [] : [t.pullState(state)])]
  return said.length === 0 ? "" : t.paren(said.join(t.listSeparator))
}

async function status($: EngineInterface, ctx: Context) {
  const { value: held } = await $.state.get({ plugin: "gh-inbox", key: "watch" })
  const now = await $.clock.now()
  const { t } = ctx
  const lines: string[] = []
  if (held === undefined || held === null || held.branch === null) lines.push(t.noBranch)
  else if (held.pull === null) lines.push(t.noPull(held.branch))
  else {
    lines.push(`${held.pull} ${held.title ?? ""}${stateOf(t, held.state, held.status?.isDraft === true)}`)
    // Where it stands, as the line under the prompt tells it with the reviewers named, the number left off.
    const parts = held.state === "OPEN" ? await pullItems($, ctx, now, ms => ago(t, ms), true) : undefined
    const stands = parts === undefined ? "" : statusText(parts, false)
    if (stands !== "") lines.push(`  ${stands}`)
  }
  if (held?.checkedAt != null) lines.push(t.lastChecked(ago(t, now - held.checkedAt)))
  if (held?.error != null) lines.push(t.error(held.error))
  const watched = Object.keys(await readWatched($)).length
  const found = ctx.mine ? await read($, mine) : null
  const count = (group: MineGroup) => (found?.[group] === undefined ? 0 : found[group].pulls.length + found[group].more)
  const [opened, requested] = [count("opened"), count("requested")]
  if (opened + requested + watched > 0) lines.push(t.pullCounts(opened + requested > 0 ? { opened, requested } : undefined, watched))
  const repos = Object.keys(toRepos(await $.store.get(REPOS_KEY))).length
  if (repos > 0) lines.push(t.registeredCount(repos))
  // Where they show goes without saying, but for when it is another window.
  if (!(await isShowing($, ctx, now))) lines.push(t.showsElsewhere)

  return lines.map(plain).join("\n")
}

/** The commands `/inbox` alone names, each with what it does. */
const COMMANDS_ABOUT = ["check", "log", "pr", "repo", "nick", "tray", "clear"] as const

/** Rows of `pairs`, indented, each one's second part where the longest first one ends. */
function aligned(pairs: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...pairs.map(([name]) => cells(name)))
  return pairs.map(([name, value]) => `  ${name}${" ".repeat(width - cells(name) + 2)}${value}`)
}

/** What `/inbox` alone says: what `/inbox status` says, then each setting as it is now and how to change it, then the commands. */
async function overview($: EngineInterface, ctx: Context) {
  const { t } = ctx
  const names = t.settingNames
  const settings: [string, string][] = [
    [names.intervalSeconds, t.seconds(ctx.intervalSeconds)],
    // What is not one of the others is a toast.
    [names.channel, ["log", "row", "notify"].includes(ctx.channel) ? ctx.channel : "toast"],
    [names.language, ctx.language],
    [names.tray, ctx.tray ? t.trayIs(toTrayView(await $.store.get(TRAY_VIEW_KEY))) : t.isOn(false)],
    [names.myPulls, t.isOn(ctx.mine)],
    [names.ciToClaude, t.isOn(ctx.ciToClaude)],
    [names.notifySelf, t.isOn(ctx.notifySelf)],
    [names.maxRepos, t.repoLimit(ctx.maxRepos)],
  ]
  const commands = COMMANDS_ABOUT.map(name => [`/inbox ${name}`, t.commandsAbout[name]] as const)

  return [await status($, ctx), "", t.settingsHeading, ...aligned(settings), "", t.commandsHeading, ...aligned(commands)].join("\n")
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
      if (cache !== undefined) {
        const eventAt = newestEventAt(cache)
        lines.push(`  ${t.lastCheckedRepo(ago(t, now - cache.at), eventAt === undefined ? undefined : ago(t, now - eventAt))}`)
      }
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

/**
 * What a prompt tells Claude of the branch's pull request's CI, unasked: a result it was not told of in
 * this session, `key` saying how CI stood and `at` when GitHub was asked. Not while the rest still run with
 * none failed, nor what was asked before what Claude was told last (a pick may have read CI afresh), nor once
 * the branch is not the one last checked: that one's CI goes with a prompt after it is checked.
 */
async function ciNews($: EngineInterface, ctx: Context): Promise<{ key: string; at: number; context: string } | undefined> {
  const watched = ctx.ci
  const key = watched === undefined ? null : ciKey(watched.ci)
  if (watched === undefined || key === null || !isResult(key) || key === (await read($, ciTold)) || watched.at < (await read($, ciToldAt)))
    return undefined
  if ((await currentBranch($).catch(() => null)) !== watched.branch) return undefined

  return { key, at: watched.at, context: ciForPrompt(ctx.t, watched.ref, watched.title, watched.url, watched.ci) }
}

/**
 * How CI of the branch's pull request (`ref`) stood as it was picked to go with a prompt (its `ciKey`),
 * and when it was asked of GitHub; undefined where none was picked.
 */
function pickedCi(held: readonly GhStaged[], ref: PullRef | null | undefined): { key: string; at: number } | undefined {
  if (ref === null || ref === undefined) return undefined
  const key = pullKey(ref).toLowerCase()
  const one = held.find(staged => staged.pull.toLowerCase() === key)
  const item = one?.items.find(each => each.id.startsWith(CI_ITEM_PREFIX))
  return item === undefined ? undefined : { key: item.id.slice(CI_ITEM_PREFIX.length), at: one?.at ?? 0 }
}

/** Shows in the pane of `/inbox pr` what the pull request holds now to hand to Claude, what is staged from it chosen already. */
async function loadItems($: EngineInterface, ctx: Context, ref: PullRef) {
  ctx.picking += 1
  const token = ctx.picking
  await update($, pick, (): GhPick => ({ stage: "loading", message: ctx.t.loadingPull(pullName(ref)) }))
  await update($, pickUnfolded, () => [])
  let shown: GhPick
  try {
    const at = await $.clock.now()
    const run = await $.process.run(pickArgv(ref))
    if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || ctx.t.exitedWith("gh api", run.exitCode))
    const picked = parsePicked(ref, run.stdout, toNicknames(await $.store.get(NICKNAMES_KEY)), ctx.language)
    // Keyed as GitHub spells it, whatever case was typed, so a pull request is staged once.
    const key = pullKeyOfUrl(picked.url, ref)
    const held = (await read($, staged)).find(one => one.pull === key)
    const ids = new Set(picked.items.map(item => item.id))
    const chosen = (held?.items ?? []).map(item => item.id).filter(id => ids.has(id))
    shown = { stage: "items", pull: key, ...picked, chosen, at }
  } catch (error) {
    shown = { stage: "error", message: ctx.t.cannotRead(pullName(ref), message(error)) }
  }
  if (token === ctx.picking) await update($, pick, () => shown)
}

/**
 * The open pull requests of this repository and those of the registered ones the person is involved in, one search a
 * host; `errors` says which hosts could not be searched, and why.
 */
async function searchPulls($: EngineInterface, ctx: Context) {
  const here = await hereRepo($)
  const registered = Object.keys(toRepos(await $.store.get(REPOS_KEY)))
    .map(refOfKey)
    .filter(ref => here === null || repoKey(ref).toLowerCase() !== repoKey(here).toLowerCase())
  const hosts = [...new Set([...(here === null ? [] : [here.host]), ...registered.map(ref => ref.host)])]
  const pulls: GhPickPull[] = []
  const notes: string[] = []
  const errors: string[] = []
  for (const host of hosts) {
    const argv = pullsArgv(host, here?.host === host ? here : null, registered.filter(ref => ref.host === host))
    if (argv === null) continue
    try {
      const run = await $.process.run(argv)
      if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || ctx.t.exitedWith("gh api", run.exitCode))
      const found = parsePulls(run.stdout, ctx.language)
      pulls.push(...found.pulls.filter(pull => !pulls.some(one => one.key === pull.key)))
      notes.push(...found.notes)
    } catch (error) {
      errors.push(`${host}: ${message(error)}`)
    }
  }

  return { pulls, notes, errors }
}

/** Turns one item of the pull request shown on or off: a review with its threads. */
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

/** Stages the chosen items in place of what was staged from that pull request, and closes the pane: they go with the next prompt. */
async function stageChosen($: EngineInterface, ctx: Context) {
  const held = await read($, pick)
  if (held?.stage !== "items") return
  const items = held.items.filter(item => held.chosen.includes(item.id))
  await update($, staged, list => [
    ...list.filter(one => one.pull !== held.pull),
    ...(items.length === 0 ? [] : [{ pull: held.pull, title: held.title, url: held.url, head: held.head, items, language: ctx.language, at: held.at }]),
  ])
  await $.ui.close({ id: PR_PANE })
}

// A host other than github.com is named, so the same owner/repo#N on two hosts is told apart.
const pullLabel = (key: string) => {
  const ref = refOfPullKey(key)
  return ref === null ? key : `${ref.host === "github.com" ? "" : `${ref.host}/`}${pullName(ref)}`
}

/**
 * Starts watching a pull request (`key` as GitHub spells it): a first look at the next check takes what it holds as
 * seen, so its notices start from now.
 */
async function startWatching($: EngineInterface, ctx: Context, key: string, title: string) {
  // What another window's check under way at a removal wrote back is not the first look's baseline.
  await $.store.delete(`${SHARED_SEEN_PREFIX}${key}`)
  // When it was added: every window that watched it before starts over from a first look.
  const since = await $.clock.now()
  await writeWatched($, key, () => ({ title, since }))
  void check($, ctx)
}

/** Stops watching a pull request; watched again, it starts over from a first look in every window (`since`). */
async function stopWatching($: EngineInterface, ctx: Context, key: string) {
  await writeWatched($, key, () => undefined)
  ctx.watchErrors.delete(key)
}

/** What watching a pull request, or stopping it, came to: whether it was done, and what to say of it. */
type Watching = { isDone: boolean; text: string }

/** Starts watching the pull request `ref`, as GitHub spells it, where it is open and the list has room. */
async function watchPull($: EngineInterface, ctx: Context, ref: PullRef): Promise<Watching> {
  const { t } = ctx
  const watched = await readWatched($)
  const held = findWatched(watched, pullKey(ref))
  if (held !== undefined) return { isDone: false, text: t.alreadyWatched(pullLabel(held)) }
  if (Object.keys(watched).length >= WATCHED_MAX) return { isDone: false, text: t.tooManyWatched(WATCHED_MAX) }
  let pull: Pull
  try {
    pull = (await fetchPull($, ctx, ref, await $.clock.now())).pull
  } catch (error) {
    return { isDone: false, text: t.cannotRead(pullLabel(pullKey(ref)), message(error)) }
  }
  // Watched as GitHub spells it, the key the branch's own and a registered repository's notices go by, so each is told once.
  const key = pullKeyOfUrl(pull.url, ref)
  const named = findWatched(watched, key)
  if (named !== undefined) return { isDone: false, text: t.alreadyWatched(pullLabel(named)) }
  if (pull.state !== "OPEN") return { isDone: false, text: t.watchNotOpen(pullLabel(key), t.pullState(pull.state)) }
  await startWatching($, ctx, key, pull.title)

  return { isDone: true, text: t.watching(pullLabel(key), plain(pull.title)) }
}

/** Stops watching the pull request `ref`, whatever the case it is named in. */
async function unwatchPull($: EngineInterface, ctx: Context, ref: PullRef): Promise<Watching> {
  const held = findWatched(await readWatched($), pullKey(ref))
  if (held === undefined) return { isDone: false, text: ctx.t.notWatched(pullLabel(pullKey(ref))) }
  await stopWatching($, ctx, held)

  return { isDone: true, text: ctx.t.unwatched(pullLabel(held)) }
}

/**
 * The pull request `/inbox pr` names (`12`, `owner/repo#12`, its URL), or else the branch's; a string says why there is
 * none. `action` is what it is named for, as the command words it ("" to show it).
 */
async function namedPull($: EngineInterface, ctx: Context, arg: string, action: string): Promise<PullRef | string> {
  const { t } = ctx
  if (arg !== "") {
    const isBare = /^#?\d+$/.test(arg)
    const ref = parsePullArg(arg, isBare ? await hereRepo($) : null)
    return ref ?? (isBare ? t.prNoHereRepo(action) : t.pullFormat)
  }
  const branch = await currentBranch($)
  if (branch === null) return t.noBranch
  try {
    const found = ctx.found?.branch === branch ? ctx.found : await lookUp($, ctx, branch, await $.clock.now())
    return found.ref ?? t.noBranchPull(branch, action)
  } catch (error) {
    return t.branchPullFailed(branch, message(error))
  }
}

/** What `/inbox pr` does to a pull request once the person confirms it in the pane. */
type ActCommand = Extract<PrAction, "merge" | "close" | "draft" | "approve" | "unapprove">

/**
 * Reads the pull request afresh and opens the pane that says what `command` would do to it, `named` the merge method
 * asked for: undefined once it opened, else why not, what cannot be done refused at once. Nothing is sent to GitHub
 * before the person presses the pane's button. Asked from the pane of `/inbox pr` (`isFromPane`), a refusal points to
 * its buttons; else to a command naming the pull request, which acts on that one whatever the branch.
 */
async function openAct(
  $: EngineInterface,
  ctx: Context,
  command: ActCommand,
  ref: PullRef,
  named: Method | undefined,
  isFromPane = false,
): Promise<string | undefined> {
  const { t } = ctx
  let pull: Pull
  try {
    pull = (await fetchPull($, ctx, ref, await $.clock.now(), true)).pull
  } catch (error) {
    return t.cannotRead(pullLabel(pullKey(ref)), message(error))
  }
  const key = pullKeyOfUrl(pull.url, ref)
  const name = pullLabel(key)
  const pr = isFromPane ? undefined : name
  if (pull.state !== "OPEN") return t.actNotOpen(name, t.pullState(pull.state))
  const status = pullStatus(pull, toNicknames(await $.store.get(NICKNAMES_KEY)), ctx.language)

  let kind: GhActKind = command === "close" ? "close" : pull.isDraft ? "ready" : "draft"
  let notes: string[] = []
  let methods: Method[] = []
  let method: Method | null = null
  let review: string | undefined
  if (command === "approve" || command === "unapprove") {
    if (pull.viewer === "") return t.cannotRead(name, t.viewerUnknown)
    // Whether the person's approval stands is asked of their own reviews alone, however many others reviewed.
    let approval: string | null
    try {
      const run = await $.process.run(viewerReviewArgv(ref, pull.viewer))
      if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || t.exitedWith("gh api", run.exitCode))
      approval = parseViewerApproval(run.stdout)
    } catch (error) {
      return t.cannotRead(name, message(error))
    }
    const plan = planReview(t, pull, command, approval, pr)
    if ("refusal" in plan) return `${name}: ${plan.refusal}`
    kind = plan.kind
    notes = plan.notes
    review = plan.kind === "unapprove" ? (approval ?? undefined) : undefined
  }
  if (command === "merge") {
    let settings: MergeSettings
    try {
      const run = await $.process.run(settingsArgv(ref))
      if (run.exitCode !== 0) throw new Error(firstLine(run.stderr) || t.exitedWith("gh api", run.exitCode))
      settings = parseSettings(run.stdout)
    } catch (error) {
      return t.cannotRead(name, message(error))
    }
    const plan = planMerge(t, pull, status, settings, pr)
    if ("refusal" in plan) return `${name}: ${plan.refusal}`
    if (named !== undefined && plan.kind !== "disable-auto" && !settings.methods.includes(named))
      return t.methodNotAllowed(methodName(t, named), settings.methods.map(one => methodName(t, one)).join(t.listSeparator))
    kind = plan.kind
    notes = plan.notes
    methods = plan.kind === "disable-auto" ? [] : settings.methods
    method = plan.kind === "disable-auto" ? null : (named ?? settings.preferred)
  }

  const stands = statusText({ head: pull.head.slice(0, 7), marks: statusMarks(t, status, { withNames: true }), latest: undefined })
  await update($, act, (): GhAct => ({
    stage: "confirm",
    kind,
    pull: key,
    title: pull.title,
    url: pull.url,
    head: pull.head,
    status: stands,
    notes,
    methods,
    method,
    ...(review === undefined ? {} : { review }),
  }))
  if (!(await $.ui.open({ id: ACT_PANE, title: t.actTitle(kind), focus: true })).isPlaced) {
    await $.ui.close({ id: ACT_PANE }).catch(() => undefined)
    await update($, act, () => null)
    return t.paneNotOpened
  }

  return undefined
}

/** Sends to GitHub what the action pane confirmed: once, however often its button is pressed; the pane says why it failed. */
async function runAct($: EngineInterface, ctx: Context) {
  if (ctx.isActing) return
  ctx.isActing = true
  try {
    const held = await read($, act)
    if (held === null || held.stage === "running") return
    await update($, act, (one): GhAct | null => one && { ...one, stage: "running" })
    const run = await $.process
      .run(actArgv(held.kind, held.url, held.head, held.method, held.review === undefined ? undefined : { id: held.review, message: ctx.t.dismissMessage }), {
        timeoutMs: ACT_TIMEOUT_MS,
      })
      .catch(error => ({ exitCode: -1, stdout: "", stderr: message(error) }))
    if (run.exitCode !== 0) {
      const why = firstLine(run.stderr) || ctx.t.exitedWith("gh", run.exitCode)
      await update($, act, (one): GhAct | null => one && { ...one, stage: "failed", message: why })
      return
    }
    await update($, act, () => null)
    await $.ui.close({ id: ACT_PANE }).catch(() => undefined)
    const name = plain(pullLabel(held.pull))
    const ref = refOfPullKey(held.pull)
    // What was done shows at once: the answer kept from before is no longer what GitHub says.
    if (ref !== null) await $.store.delete(`${CACHE_PREFIX}${pullKey(ref)}`)
    if (held.kind === "merge") {
      // `gh pr merge` succeeds too where a merge queue only took it in: merged is said once GitHub says so. Asked
      // afresh, the answer kept is the check's to tell.
      const now = await $.clock.now()
      const after = ref === null ? undefined : await fetchPull($, ctx, ref, now, true).catch(() => undefined)
      if (after !== undefined && after.pull.state !== "MERGED") $.ui.toast(ctx.t.actQueued(name), { timeoutMs: TOAST_MS })
      // A merge of the branch's or a watched pull request is told by its own notice, merges told even when the person's.
      else if (!isBranchPull(ctx, held.pull) && findWatched(await readWatched($), held.pull) === undefined)
        $.ui.toast(ctx.t.actDone(held.kind, name), { timeoutMs: TOAST_MS })
    } else $.ui.toast(ctx.t.actDone(held.kind, name), { timeoutMs: TOAST_MS })
    // The pull request `/inbox pr` shows says what was done to it.
    const shown = await read($, prDetail)
    if (ref !== null && shown?.pull.toLowerCase() === held.pull.toLowerCase()) await loadHeader($, ctx, ref)
    void check($, ctx, true)
  } finally {
    ctx.isActing = false
  }
}

/**
 * Whether the account `gh` uses approves `pull` (`ref`), by its last say: read from the reviewers' last says that came
 * with it, unless it is not among them and as many came as are asked for (it may be one left out): then asked of its
 * own reviews. What cannot be asked goes by those that came.
 */
async function viewerApproves($: EngineInterface, ref: PullRef, pull: Pull): Promise<boolean> {
  if (pull.viewer === "") return false
  const said = pull.verdicts.find(verdict => verdict.author === pull.viewer)
  if (said !== undefined || pull.verdicts.length < VERDICTS_ASKED) return said?.state === "APPROVED"
  try {
    const run = await $.process.run(viewerReviewArgv(ref, pull.viewer))
    return run.exitCode === 0 && parseViewerApproval(run.stdout) !== null
  } catch {
    return false
  }
}

/**
 * Reads where the pull request `ref` stands for the pane of `/inbox pr`: afresh where `isFresh`, else the answer kept
 * younger than one interval. What it showed of the same pull request stays while it is asked.
 */
async function loadHeader($: EngineInterface, ctx: Context, ref: PullRef, isFresh = false) {
  ctx.prShowings += 1
  const showing = ctx.prShowings
  const { t } = ctx
  const name = pullLabel(pullKey(ref))
  await update($, prDetail, (held): GhPrDetail =>
    held?.stage === "pull" && held.pull.toLowerCase() === pullKey(ref).toLowerCase() ? held : { stage: "loading", pull: pullKey(ref), message: t.loadingPull(name) },
  )
  let shown: GhPrDetail
  try {
    const { pull, at } = await fetchPull($, ctx, ref, await $.clock.now(), isFresh)
    const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
    const isOwn = pull.viewer !== "" && pull.author === pull.viewer
    shown = {
      stage: "pull",
      pull: pullKeyOfUrl(pull.url, ref),
      title: pull.title,
      url: pull.url,
      state: pull.state,
      author: pull.author === null ? null : displayName(pull.author, nicknames, ctx.language),
      isOwn,
      isApproved: !isOwn && (await viewerApproves($, ref, pull)),
      head: pull.head,
      status: pullStatus(pull, nicknames, ctx.language),
      at,
    }
  } catch (error) {
    shown = { stage: "error", pull: pullKey(ref), message: t.cannotRead(name, message(error)) }
  }
  if (showing === ctx.prShowings) await update($, prDetail, () => shown)
}

/** Shows the pull request `ref` in the pane of `/inbox pr`: where it stands, and what it holds to hand to Claude. */
async function showPull($: EngineInterface, ctx: Context, ref: PullRef, isFresh = false) {
  await Promise.all([loadHeader($, ctx, ref, isFresh), loadItems($, ctx, ref)])
}

/** Opens the pane of `/inbox pr` on the pull request `ref`; whether it opened. */
async function openPull($: EngineInterface, ctx: Context, ref: PullRef) {
  await update($, prDetail, (): GhPrDetail => ({ stage: "loading", pull: pullKey(ref), message: ctx.t.loadingPull(pullLabel(pullKey(ref))) }))
  if (!(await $.ui.open({ id: PR_PANE, title: ctx.t.prTitle, focus: true })).isPlaced) return false
  await showPull($, ctx, ref)

  return true
}

/**
 * Looks for what the list of `/inbox pr` shows besides what the checks found: the open pull requests of this repository
 * and those of the registered ones the person is involved in, and the person's own where the band does not search them.
 */
async function lookForList($: EngineInterface, ctx: Context) {
  const listing = ctx.prListings
  let found: GhPrFound
  try {
    const { pulls, notes, errors } = await searchPulls($, ctx)
    const mineFound = ctx.mine ? undefined : await findMine($, ctx, null)
    found = { stage: "found", pulls, notes: [...errors.map(ctx.t.notSearched), ...notes], ...(mineFound === undefined ? {} : { mine: mineFound }) }
  } catch (error) {
    found = { stage: "found", pulls: [], notes: [ctx.t.searchFailed(message(error))] }
  }
  if (listing === ctx.prListings) await update($, prFound, () => found)
}

/** Opens the pane of `/inbox pr` on the list of pull requests, looked for afresh; whether it opened. */
async function openList($: EngineInterface, ctx: Context) {
  ctx.prListings += 1
  // A pull request still asked for as the list opens is not shown over it.
  ctx.prShowings += 1
  ctx.askedHeadings.clear()
  await update($, prHeadings, () => ({}))
  await update($, prFound, (): GhPrFound => ({ stage: "searching" }))
  await update($, prDetail, () => null)
  if (!(await $.ui.open({ id: PR_PANE, title: ctx.t.prTitle, focus: true })).isPlaced) return false
  await lookForList($, ctx)

  return true
}

/** The groups the list of `/inbox pr` puts pull requests in, in the order it shows them. */
type PrGroup = "branch" | MineGroup | "watched" | "noticed" | "here"

/** One row of the list of `/inbox pr`. */
type PrRow = {
  /** `host/owner/repo#number`. */
  key: string
  /** Its repository's short name (a registered one's alias, else its name) and its number: `tts#20`. */
  label: string
  title: string
  state: PullState | null
  /** Where it stands; null while it is not known. */
  status: GhPullStatus | null
  /** Who opened it, by the name the mod shows: for one found that the person did not open. */
  author?: string
  /** For one the log keeps notices of: how many, and when the newest happened. */
  noticed?: { count: number; at: string }
}

/**
 * The list of `/inbox pr`, a group each, every pull request once, in the first group it falls in: the branch's, the
 * person's own, those asked of them to review, those watched, those the log keeps notices of (the newest few), and
 * the rest found open in this repository and in the registered ones the person is involved in. `more` counts those
 * a group leaves out.
 */
async function prList($: EngineInterface, ctx: Context): Promise<Array<{ group: PrGroup; rows: PrRow[]; more: number }>> {
  const repos = await readRepos($)
  const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
  const headings = await read($, prHeadings)
  const found = await read($, prFound)
  const listed = new Set<string>()
  const groups: Array<{ group: PrGroup; rows: PrRow[]; more: number }> = []
  const add = (group: PrGroup, rows: readonly PrRow[], more = 0) => {
    const fresh = rows.filter(row => !listed.has(row.key.toLowerCase()))
    for (const row of fresh) listed.add(row.key.toLowerCase())
    if (fresh.length > 0) groups.push({ group, rows: fresh, more })
  }
  const labelOf = (key: string) => {
    const ref = refOfPullKey(key)
    return ref === null ? key : watchLabel(repos, ref)
  }
  /** What GitHub said of a row found with nothing of where it stands, where it was asked. */
  const headed = (key: string, title: string, author: string | null, noticed?: PrRow["noticed"]): PrRow => {
    const heading = headings[key]
    return {
      key,
      label: labelOf(key),
      title: heading?.title || title,
      state: heading?.state ?? null,
      status: heading?.status ?? null,
      ...(author === null ? {} : { author: displayName(author, nicknames, ctx.language) }),
      ...(noticed === undefined ? {} : { noticed }),
    }
  }

  const branch = await read($, watch)
  const ref = ctx.found?.ref
  if (ref != null && branch?.pull != null)
    add("branch", [{ key: pullKey(ref), label: watchLabel(repos, ref), title: branch.title ?? "", state: branch.state, status: branch.status ?? null }])

  const own = ctx.mine ? await read($, mine) : found?.stage === "found" ? (found.mine ?? null) : null
  for (const group of MINE_GROUPS) {
    const pulls = own?.[group]?.pulls ?? []
    const rows = pulls.map(
      (pull): PrRow => ({ key: pull.key, label: pull.label, title: pull.title, state: "OPEN", status: pull.status, ...(group === "requested" && pull.author !== undefined ? { author: pull.author } : {}) }),
    )
    add(group, rows, own?.[group]?.more ?? 0)
  }

  const watchedRows: PrRow[] = []
  for (const [key, entry] of Object.entries(await readWatched($))) {
    const one = refOfPullKey(key)
    if (one === null) continue
    const cached = await cachedPull($, ctx, one)
    watchedRows.push({
      key,
      label: watchLabel(repos, one),
      title: cached?.pull.title ?? entry.title,
      state: cached?.pull.state ?? entry.done?.state ?? "OPEN",
      status: cached === undefined ? null : pullStatus(cached.pull, nicknames, ctx.language),
    })
  }
  add("watched", watchedRows)

  // Those the log keeps notices of, the newest first: one GitHub says is no pull request is left off.
  const history = await readHistory($)
  const noticed = noticedPulls(latest(history, history.length).reverse()).flatMap(group =>
    group.key === undefined || listed.has(group.key.toLowerCase()) || headings[group.key]?.isPull === false ? [] : [{ ...group, key: group.key }],
  )
  const shown = noticed.slice(0, NOTICED_SHOWN)
  const searched = found?.stage === "found" ? found.pulls.filter(pull => headings[pull.key]?.isPull !== false) : []
  const known = await knownTitles($, [...shown.map(group => group.key), ...searched.map(pull => pull.key)])
  add(
    "noticed",
    shown.map(group => headed(group.key, known.get(group.key) ?? "", null, { count: group.events.length, at: group.events[0]?.at ?? "" })),
    noticed.length - shown.length,
  )
  add(
    "here",
    searched.map(pull => {
      const row = headed(pull.key, pull.title, pull.author)
      // Found open by the search, it is open while GitHub has not said otherwise.
      return { ...row, state: row.state ?? "OPEN" }
    }),
  )

  return groups
}

/** What `/inbox pr` says it does with its words: shows a pull request or the list, does something to one. */
async function prCommand($: EngineInterface, ctx: Context, words: readonly string[]): Promise<string> {
  const { t } = ctx
  if (words.length === 0) return (await openList($, ctx)) ? t.prListOpened : t.paneNotOpened
  const said = parsePrWords(words)
  if (said === undefined) return t.prUsage
  // Showing it goes without saying where the pull request is named.
  const ref = await namedPull($, ctx, said.pull, said.action === undefined || said.action === "show" ? "" : said.action)
  if (typeof ref === "string") return ref
  switch (said.action) {
    case undefined:
    case "show":
      return (await openPull($, ctx, ref)) ? t.prOpened : t.paneNotOpened
    case "watch":
      return (await watchPull($, ctx, ref)).text
    case "unwatch":
      return (await unwatchPull($, ctx, ref)).text
    default:
      return (await openAct($, ctx, said.action, ref, said.method)) ?? t.actPaneOpened
  }
}

export const register: Register = (on, options) => {
  const language = toLanguage(options.language)
  const t = MESSAGES[language]
  const ctx: Context = {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, Number(options.intervalSeconds) || 60),
    maxRepos: Math.max(1, Number(options.maxRepos) || 20),
    channel: String(options.channel),
    notifySelf: options.notifySelf === true,
    tray: options.tray !== false,
    ciToClaude: options.ciToClaude !== false,
    mine: options.myPulls !== false,
    language,
    t,
    found: undefined,
    branch: undefined,
    running: undefined,
    checks: 0,
    sessionId: "",
    activeAt: 0,
    touchedAt: 0,
    viewers: new Map(),
    repoErrors: new Map(),
    watchErrors: new Map(),
    watchHeads: new Map(),
    retries: new Map(),
    toggling: Promise.resolve(),
    picking: 0,
    prShowings: 0,
    prListings: 0,
    isEnded: false,
    askedLatest: new Set(),
    logOpenings: 0,
    askedHeadings: new Set(),
    ci: undefined,
    isActing: false,
    isPrPressing: false,
    teamless: new Set(),
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
    $.ui.status(undefined)
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
    void followBranch($, ctx).catch(() => undefined)
    // What is staged, and CI's news, go with the next prompt the person sends, not with a command or a prompt of a plugin's.
    const isPersons = (e.origin.kind === "composer" || e.origin.kind === "bridge") && e.command === undefined && e.isMeta !== true
    if (!isPersons) return next(e)
    // Taken at once, so a second prompt sent meanwhile does not carry it too; put back when this one does not go.
    let held: GhStaged[] = []
    await update($, staged, list => {
      held = list
      return []
    })
    // CI of the branch's pull request picked goes as picked, in place of what the last check found, and counts as told:
    // the pick may have read a result newer than that check's, which is not told again once a check catches up.
    const picked = ctx.ciToClaude ? pickedCi(held, ctx.found?.ref) : undefined
    const news = ctx.ciToClaude && picked === undefined ? await ciNews($, ctx).catch(() => undefined) : undefined
    const told = picked ?? news
    if (held.length === 0 && news === undefined) return next(e)
    let toldBefore: string | null = null
    let toldAtBefore = 0
    if (told !== undefined) {
      await update($, ciTold, before => {
        toldBefore = before
        return told.key
      })
      await update($, ciToldAt, before => {
        toldAtBefore = before
        return Math.max(before, told.at)
      })
    }
    const putBack = async () => {
      await update($, staged, list => [...held.filter(one => !list.some(other => other.pull === one.pull)), ...list])
      if (told === undefined || (await read($, ciTold)) !== told.key) return
      await update($, ciTold, () => toldBefore)
      await update($, ciToldAt, () => toldAtBefore)
    }
    try {
      const result = await next({ ...e, context: [...(e.context ?? []), ...(news === undefined ? [] : [news.context]), ...stagedContext(held, ctx.language)] })
      if (result.drop !== undefined) await putBack()
      return result
    } catch (error) {
      await putBack()
      throw error
    }
  })

  on("command.run", { command: COMMAND }, async ($, e) => {
    await touch($, ctx, true).catch(() => undefined)
    const [action, ...rest] = e.args.trim().split(/\s+/).filter(word => word !== "")

    switch (action) {
      case undefined:
        return { text: await overview($, ctx) }
      case "status":
        return { text: await status($, ctx) }
      case "check":
        await check($, ctx, true)
        return { text: await status($, ctx) }
      case "log": {
        const history = await readHistory($)
        if (history.length === 0) return { text: t.noLog }
        // `/inbox log <repository>` narrows it to one repository; `text` lists them in the transcript, for Claude to read.
        const asText = rest.includes("text")
        const named = rest.filter(word => word !== "text").join(" ")
        let narrowed: LogRepo | undefined
        if (named !== "") {
          const repos = await readLogRepos($, history)
          narrowed = findLogRepo(repos, named)
          if (narrowed === undefined) return { text: t.logNoRepo(named, repos.map(one => one.label)) }
        }
        const all = narrowed === undefined ? history : history.filter(event => repoOfEvent(event) === narrowed.repo)
        // In a pane, so a long log does not run down the transcript; where no pane opens, the newest as text.
        await update($, logPage, () => 0)
        await update($, logUnfolded, () => [])
        await update($, logRepo, () => narrowed?.repo ?? null)
        // What the comments say now is asked for afresh each time the log opens.
        ctx.logOpenings += 1
        ctx.askedLatest.clear()
        await update($, logLatest, () => ({}))
        if (!asText && (await $.ui.open({ id: LOG_PANE, title: t.logTitle, focus: true })).isPlaced)
          return { text: t.logOpened(all.length) }
        const list = latest(all, LOG_SHOWN)
        const now = await $.clock.now()
        const when = (event: GhEvent) => {
          const at = Date.parse(event.at)
          return Number.isNaN(at) ? "" : t.paren(ago(t, now - at))
        }
        return { text: logText(list.map(event => ({ text: plain(event.text), url: plain(event.url), when: when(event) }))) }
      }
      case "repo": {
        const text = await repoCommand($, ctx, rest)
        await drawTray($, ctx)
        return { text }
      }
      case "pr":
        return { text: await prCommand($, ctx, rest) }
      case "tray":
        return { text: await trayCommand($, ctx, rest) }
      // Each pull request's commands went under `/inbox pr`: where they went is said.
      case "pick":
      case "watch":
      case "merge":
      case "close":
      case "draft":
      case "approve":
      case "unapprove":
        return { text: t.movedToPr(action) }
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

  /**
   * One log row: on its first line the repository's short name in color, who did it and what (a link to it) bold
   * in color, when dim; what they said under it, indented, wrapping onto as many lines as it takes.
   */
  const drawLogRow = (
    ui: ReturnType<EngineInterface["ui"]["resolve"]>,
    row: LogRow,
    made: LogMade | undefined,
    // The log pane's: what unfolds the row, and what it says in full once unfolded.
    fold?: { mark: ReturnType<typeof ui.Button>; full?: readonly LatestItem[] },
    // What leads its first line, dim: a transcript row's `GitHub: `.
    lead?: string,
  ) => {
    const { Box, Text, Link } = ui
    // A notice kept with its head says its short name, or that it has none.
    const { label, rest } = splitLabel(row.text, made?.head === undefined ? undefined : (made.label ?? null))
    const { who, action, detail } = splitNotice(rest, language, made)
    // What joins the head to what follows (": ", "。") or ends a head alone (".") is not drawn: the line break parts them.
    const body = detail.replace(DETAIL_LEAD, "").trimEnd()
    const lines = (text: string, key: string) => text.split("\n").map((line, i) => <Text key={`${key}:${i}`}>{plain(line) || " "}</Text>)
    // A push or commit keeps its line counts above its commits; anything else says in full what its line said in short.
    const isPush = CHANGED_KINDS.has(made?.kind ?? "")
    const full = fold?.full?.map((item, i) => (
      <Box key={`item:${i}`} flexDirection="column">
        {item.path === undefined ? (
          item.note === undefined ? null : <Text dimColor>{t.paren(t.logItemNote(item.note)).trim()}</Text>
        ) : (
          <Text dimColor>
            {plain(item.path)}
            {typeof item.line === "number" ? `:${item.line}` : ""}
            {item.note === undefined ? "" : t.paren(t.logItemNote(item.note))}
          </Text>
        )}
        {isPush ? <Text>・{plain(item.body)}</Text> : lines(item.body, `body:${i}`)}
      </Box>
    ))
    const head = (
      <Text>
        {lead === undefined ? null : <Text dimColor>{lead}</Text>}
        {label === "" ? null : <Text color={LABEL_COLOR}>{label}</Text>}
        {who === "" && action === "" ? null : (
          <Text bold color={HEAD_COLOR}>
            {who}
            {row.url === "" || action === "" ? action : <Link href={row.url}>{action}</Link>}
          </Text>
        )}
        {row.when === "" ? null : <Text dimColor>{row.when}</Text>}
      </Text>
    )
    const short = body === "" ? null : <Text>{CHANGED_KINDS.has(made?.kind ?? "") ? changed(body, Text) : body}</Text>
    return (
      <Box flexDirection="column">
        {fold === undefined ? head : (
          <Box>
            {fold.mark}
            {head}
          </Box>
        )}
        {full === undefined ? (
          short === null ? null : <Box paddingLeft={LOG_INDENT}>{short}</Box>
        ) : (
          <Box paddingLeft={LOG_INDENT} flexDirection="column">
            {isPush ? short : null}
            {full}
          </Box>
        )}
      </Box>
    )
  }

  // `/inbox log`'s row draws each notice with its repository's short name in color and what was done as a link to it;
  // the text, URLs written out, is what the model reads.
  on("ui.render", { component: "CommandOutput", props: { command: COMMAND } }, async ($, e, next) => {
    const isLog = e.props.args.trim().split(/\s+/)[0] === "log"
    const rows = isLog && !e.props.isErrored ? parseLog(e.props.text) : undefined
    if (rows === undefined) return next(e)
    const ui = $.ui.resolve(e)
    // Who did each as its notice named them, from the log the rows were listed from: a row it no longer keeps is read as it reads.
    const known = new Map(
      (await readHistory($)).map(event => [`${plain(event.text)}\n${plain(event.url)}`, madeOf(event)]),
    )
    return <ui.Box flexDirection="column">{rows.map(row => drawLogRow(ui, row, known.get(`${row.text}\n${row.url}`)))}</ui.Box>
  })

  // A row the `row` channel placed: its notice as the log draws it, what was done a link to it on GitHub.
  on("ui.render", { component: "Placed", props: { plugin: "gh-inbox" } }, async ($, e, next) => {
    const row = (await read($, placed)).find(one => one.id === e.props.id)
    if (row === undefined) return next(e)
    const ui = $.ui.resolve(e)
    if (row.made === undefined) return <ui.Text dimColor>{row.text}</ui.Text>
    return drawLogRow(ui, { text: row.text, url: row.url, when: "" }, row.made, undefined, "GitHub: ")
  })

  // The log pane: every notice kept, newest first, a page at a time; narrowed to one repository, its notices alone.
  on("ui.render", { component: "Pane", requestId: LOG_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const history = await readHistory($)
    const repos = await readLogRepos($, history)
    // A repository chosen whose notices are no longer kept shows them all.
    const narrowedTo = await read($, logRepo)
    const chosen = repos.find(one => one.repo === narrowedTo)
    const all = chosen === undefined ? history : history.filter(event => repoOfEvent(event) === chosen.repo)
    const list = latest(all, all.length).reverse()
    const pages = Math.max(1, Math.ceil(list.length / LOG_PAGE))
    const page = Math.min(Math.max(0, await read($, logPage)), pages - 1)
    const shown = list.slice(page * LOG_PAGE, (page + 1) * LOG_PAGE)
    const now = await $.clock.now()
    const unfolded = await read($, logUnfolded)
    const latestOf = await read($, logLatest)
    void lookUpLatest($, ctx, shown)
    const turn = (to: number) => () => void update($, logPage, () => to)
    const narrow = (to: string | null) => async () => {
      await update($, logRepo, () => to)
      await update($, logPage, () => 0)
    }
    // `r` goes to the next repository, after the last back to all.
    const options: Array<string | null> = [null, ...repos.map(one => one.repo)]
    const next = options[(options.indexOf(chosen?.repo ?? null) + 1) % options.length] ?? null

    /** One notice of the page, `index` its place on it. */
    const drawPaneRow = (event: GhEvent, index: number) => {
      const at = Date.parse(event.at)
      const change = changeOf(event, latestOf[latestKey(event) ?? ""])
      const editedAt = Date.parse(change?.editedAt ?? "")
      // Beside when it happened, whether the comment was edited (and when) or deleted since it was told.
      const remarks = [
        ...(Number.isNaN(at) ? [] : [ago(t, now - at)]),
        ...(change?.isDeleted === true ? [t.logDeleted] : []),
        ...(change?.editedAt != null ? [t.logEdited(Number.isNaN(editedAt) ? "" : ago(t, now - editedAt)).trim()] : []),
        ...(change?.isPartDeleted === true ? [t.logPartDeleted] : []),
      ]
      const row = { text: plain(event.text), url: plain(event.url), when: remarks.length === 0 ? "" : t.paren(remarks.join(t.listSeparator)) }
      const key = `${event.pull}|${event.id}`
      // An edited comment unfolds to what it says now, however short; a review, to which of its comments changed.
      const said = saidInFull(event)
      const full =
        change !== undefined && !change.isDeleted ? change.items.filter(item => item.body.trim() !== "" || item.note !== undefined) : said
      const isOpen = full !== undefined && unfolded.includes(key)
      // A row with more to say than its line unfolds by its mark, or the digit of its place on the page.
      const mark =
        full === undefined ? (
          <Text>{"  "}</Text>
        ) : (
          <Button
            key={`unfold:${key}`}
            hotkey={index < 10 ? String((index + 1) % 10) : undefined}
            plain
            label={isOpen ? "▾ " : "▸ "}
            onPress={() => void update($, logUnfolded, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key]))}
          />
        )
      return <Box key={key}>{drawLogRow(ui, row, madeOf(event), { mark, full: isOpen ? full : undefined })}</Box>
    }

    return (
      <Box flexDirection="column">
        {repos.length > 1 && (
          <Box>
            {[{ repo: null, label: t.logAll } as const, ...repos].map(one => {
              const isChosen = (chosen?.repo ?? null) === one.repo
              return (
                <Button
                  key={`repo:${one.repo ?? ""}`}
                  hotkey={one.repo === next ? "r" : undefined}
                  plain
                  dimColor={!isChosen}
                  label={isChosen ? `[${plain(one.label)}]` : ` ${plain(one.label)} `}
                  onPress={() => void narrow(one.repo)()}
                />
              )
            })}
          </Box>
        )}
        <Text dimColor>{list.length === 0 ? t.noLog : t.logRange(page * LOG_PAGE + 1, page * LOG_PAGE + shown.length, list.length)}</Text>
        {shown.map((event, index) => drawPaneRow(event, index))}
        <Box>
          {page + 1 < pages && <Button key="older" hotkey="n" label={t.older} onPress={turn(page + 1)} />}
          {page > 0 && <Button key="newer" hotkey="p" label={t.newer} onPress={turn(page - 1)} />}
          <Button key="close" hotkey="q" label={t.close} onPress={() => void $.ui.close({ id: LOG_PANE })} />
        </Box>
      </Box>
    )
  })

  // What `/inbox pr`'s merge, close, draft, approve or unapprove would do, done only by its button: no hotkey, nothing
  // focused at first, so neither a key typed for the prompt nor an Enter sends it.
  on("ui.render", { component: "Pane", requestId: ACT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, act)
    const cancel = async () => {
      await update($, act, () => null)
      await $.ui.close({ id: ACT_PANE }).catch(() => undefined)
    }
    const close = <Button key="cancel" hotkey="q" label={held?.stage === "failed" ? t.close : t.cancel} onPress={() => void cancel()} />
    if (held === null) return close
    const isRunning = held.stage === "running"
    const choose = (method: string) => update($, act, (one): GhAct | null => (one === null || one.stage === "running" ? one : { ...one, method, stage: "confirm" }))

    return (
      <Box flexDirection="column">
        <Text bold>
          {plain(pullLabel(held.pull))} {plain(held.title)}
        </Text>
        <Text>{held.status}</Text>
        {held.notes.map(note => (
          <Text key={note} color="warning">
            {note}
          </Text>
        ))}
        {held.methods.length > 1 && !isRunning && (
          <Box>
            <Text>{t.methodHint} </Text>
            {held.methods.map((method, index) => (
              <Button
                key={`method:${method}`}
                hotkey={String(index + 1)}
                plain
                dimColor={method !== held.method}
                label={method === held.method ? `[${methodName(t, method)}]` : ` ${methodName(t, method)} `}
                onPress={() => void choose(method)}
              />
            ))}
          </Box>
        )}
        {isRunning ? (
          <Text dimColor>{t.actRunning}</Text>
        ) : held.stage === "failed" ? (
          <Text color="error">{t.actFailed(plain(held.message ?? ""))}</Text>
        ) : (
          <Text dimColor>{t.actHint}</Text>
        )}
        {!isRunning && (
          <Box>
            {close}
            <Button key="act" variant="primary" label={t.actConfirm(held.kind, held.method === null ? "" : methodName(t, held.method))} onPress={() => void runAct($, ctx)} />
          </Box>
        )}
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
              ctx.toggling = ctx.toggling.then(() => toggleKind($, kind)).then(() => drawTray($, ctx)).catch(() => undefined)
            }}
          />
        ))}
        <Button label={t.close} onPress={() => void $.ui.close({ id: PICKER_PANE })} />
      </Box>
    )
  })

  // The pane of `/inbox pr`: the list of pull requests, a group each, a row each that opens it; or one of them, where it
  // stands, what can be done to it, and what it holds to hand to Claude.
  on("ui.render", { component: "Pane", requestId: PR_PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const detail = await read($, prDetail)
    const now = await $.clock.now()
    const sinceAt = (at: string) => {
      const ms = Date.parse(at)
      return Number.isNaN(ms) ? undefined : ago(t, now - ms)
    }
    const close = <Button key="close" hotkey="q" label={t.close} onPress={() => void $.ui.close({ id: PR_PANE })} />
    const toList = (
      <Button
        key="list"
        hotkey="l"
        label={t.prToList}
        onPress={async () => {
          ctx.prShowings += 1
          await update($, prDetail, () => null)
          if ((await read($, prFound)) === null) await lookForList($, ctx)
        }}
      />
    )

    if (detail === null) {
      const groups = await prList($, ctx)
      const found = await read($, prFound)
      // Where those found with nothing of where they stand stand is asked for, the title with it.
      void lookUpHeadings(
        $,
        ctx,
        groups.flatMap(({ group, rows }) => (group === "noticed" || group === "here" ? rows.filter(row => row.status === null).map(row => row.key) : [])),
      )
      let index = 0
      return (
        <Box flexDirection="column">
          {found?.stage === "found" &&
            found.notes.map(note => (
              <Text key={note} color="warning">
                {plain(note)}
              </Text>
            ))}
          {groups.length === 0 && found?.stage !== "searching" && <Text>{t.prNone}</Text>}
          {groups.map(({ group, rows, more }) => (
            <Box key={`group:${group}`} flexDirection="column">
              <Text dimColor>{t.prGroup(group, rows.length, rows.length + more)}</Text>
              {rows.map(row => {
                const at = index
                index += 1
                const isEnded = row.state === "MERGED" || row.state === "CLOSED"
                const marks =
                  isEnded || row.status === null
                    ? ""
                    : statusText({ head: "", marks: statusMarks(t, row.status, { awaiting: group === "requested" ? "none" : "any" }), latest: undefined }, false)
                const flag = isEnded ? t.paren(t.pullState(row.state)) : row.status?.isDraft === true ? t.paren(t.draft) : ""
                const author = row.author === undefined ? "" : `  ${t.who(plain(row.author))}`
                const when = row.noticed === undefined ? "" : `  ${t.prNoticed(row.noticed.count, sinceAt(row.noticed.at) ?? "")}`
                const head = `${plain(row.label)}${flag}`
                // A title not known yet (asked of GitHub, or none to be had) leaves no gap.
                const title = row.title === "" ? "" : `  ${plain(row.title)}`
                const stands = `${head}${author}${marks === "" ? "" : `  ${marks}`}`
                const hotkey = at < 9 ? String(at + 1) : undefined
                // A row keeps to one line: where the pane is too narrow, the title gives way, what it says around it kept.
                const room = e.props.bodyColumns - PR_ROW_INDENT - (hotkey === undefined ? 0 : cells(`${hotkey}: `)) - cells(stands) - cells(when)
                const fitted = fitCells(title, room)
                // A gap and an ellipsis alone say nothing.
                const shownTitle = fitted.trim() === "…" ? "" : fitted
                return (
                  <Box key={`row:${row.key}`} paddingLeft={PR_ROW_INDENT}>
                    <Button
                      key={`pr:${row.key}`}
                      hotkey={hotkey}
                      plain
                      label={`${stands}${title}${when}`}
                      onPress={() => {
                        const ref = refOfPullKey(row.key)
                        if (ref !== null) void showPull($, ctx, ref)
                      }}
                    >
                      <Text color={LABEL_COLOR}>{head}</Text>
                      {author}
                      {marks === "" ? "" : `  ${marks}`}
                      <Text dimColor>{`${shownTitle}${when}`}</Text>
                    </Button>
                  </Box>
                )
              })}
            </Box>
          ))}
          <Text dimColor>{found?.stage === "searching" ? t.searchingPulls : groups.length === 0 ? "" : t.prListHint}</Text>
          {close}
        </Box>
      )
    }

    const ref = refOfPullKey(detail.pull)
    const repos = await readRepos($)
    const isWatched = findWatched(await readWatched($), detail.pull) !== undefined
    /** Says on the pane what the last button pressed came to: that GitHub is asked, or why it could not be done; else nothing. */
    const say = (said: { asking?: string; note?: string }) =>
      update($, prDetail, held => {
        if (held?.stage !== "pull" || held.pull !== detail.pull) return held
        const { note: _, asking: __, ...rest } = held
        return { ...rest, ...(said.asking === undefined ? {} : { asking: said.asking }), ...(said.note === undefined ? {} : { note: said.note }) }
      })
    /**
     * Runs what a button asks, one press at a time, the pane saying so while GitHub is asked; `run` answers why it could
     * not be done, if it could not. Where `isReread`, a refusal reads the pull request again (as GitHub just answered),
     * so the buttons follow where it stands now.
     */
    const press = (run: (one: PullRef) => Promise<string | undefined>, isReread = false) => async () => {
      if (ref === null || ctx.isPrPressing) return
      ctx.isPrPressing = true
      try {
        await say({ asking: t.prAsking })
        const note = await run(ref)
        const isShown = (await read($, prDetail))?.pull.toLowerCase() === detail.pull.toLowerCase()
        if (note !== undefined && isReread && isShown) await loadHeader($, ctx, ref)
        await say(note === undefined ? {} : { note })
      } finally {
        ctx.isPrPressing = false
      }
    }
    const doing = (command: ActCommand) => press(one => openAct($, ctx, command, one, undefined, true), true)
    const toggleWatch = press(async one => {
      const done = isWatched ? await unwatchPull($, ctx, one) : await watchPull($, ctx, one)
      return done.isDone ? undefined : done.text
    })
    const items = await read($, pick)
    const unfolded = await read($, pickUnfolded)
    // What can be handed to Claude is that of the pull request shown: one still loading, or another's, is not. What it
    // holds shows even where where it stands could not be read, and a failure the same as that one's is said once.
    const isItems = items?.stage === "items" && items.pull.toLowerCase() === detail.pull.toLowerCase()
    const itemsFailed = items?.stage === "error" && !(detail.stage === "error" && detail.message === items.message) ? items.message : undefined

    /** Where the pull request stands, and the buttons that do something to it. */
    const head = (shown: Extract<GhPrDetail, { stage: "pull" }>) => {
      const isOpen = shown.state === "OPEN"
      const said = shown.status.latest
      const latestSaid = said === null ? undefined : t.latestComment(t.who(plain(said.name)), plain(said.body), sinceAt(said.at))
      const shownRef = refOfPullKey(shown.pull)
      const about = [
        // Its repository in full: the heading names it as the list does, by its short name.
        pullLabel(shown.pull).replace(/#\d+$/, ""),
        ...(shown.author === null ? [] : [t.prBy(t.who(plain(shown.author)))]),
        ...(isOpen ? (shown.status.isDraft === true ? [t.draft] : []) : [t.pullState(shown.state)]),
        ...(isWatched ? [t.prWatchedNow] : []),
        ...(isBranchPull(ctx, shown.pull) ? [t.prIsBranch] : []),
      ]
      const marks = statusMarks(t, shown.status, { withNames: true })
      // A draft is marked ready before it is merged, by its own button: one with auto-merge on can still have it turned off.
      const canMerge = isOpen && (shown.status.isDraft !== true || shown.status.autoMerge === true)
      return (
        <Box flexDirection="column">
          <Text bold>
            <Text color={LABEL_COLOR}>
              <Link href={plain(shown.url)}>{plain(shownRef === null ? pullLabel(shown.pull) : watchLabel(repos, shownRef))}</Link>
            </Text>{" "}
            {plain(shown.title)}
          </Text>
          <Text dimColor>{plain(about.join(t.listSeparator))}</Text>
          {/* The head commit alone says nothing of where it stands. */}
          {isOpen && (marks.length > 0 || latestSaid !== undefined) && <Text>{statusText({ head: shown.head.slice(0, 7), marks, latest: latestSaid })}</Text>}
          {shown.asking !== undefined && <Text dimColor>{shown.asking}</Text>}
          {shown.note !== undefined && <Text color="warning">{plain(shown.note)}</Text>}
          <Box flexWrap="wrap">
            {(isOpen || isWatched) && <Button key="pr:watch" hotkey="w" label={isWatched ? t.prUnwatch : t.prWatch} onPress={() => void toggleWatch()} />}
            {canMerge && <Button key="pr:merge" hotkey="m" label={shown.status.autoMerge === true ? t.prDisableAuto : t.prMerge} onPress={() => void doing("merge")()} />}
            {isOpen && <Button key="pr:draft" hotkey="d" label={shown.status.isDraft === true ? t.prReady : t.prToDraft} onPress={() => void doing("draft")()} />}
            {isOpen && !shown.isOwn && (
              <Button key="pr:approve" hotkey="v" label={shown.isApproved ? t.prUnapprove : t.prApprove} onPress={() => void doing(shown.isApproved ? "unapprove" : "approve")()} />
            )}
            {isOpen && <Button key="pr:close" hotkey="x" label={t.prClose} onPress={() => void doing("close")()} />}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {detail.stage === "pull" ? head(detail) : detail.stage === "error" ? <Text>{plain(detail.message)}</Text> : <Text dimColor>{detail.message}</Text>}
        {!isItems ? (
          itemsFailed !== undefined ? (
            <Text>{plain(itemsFailed)}</Text>
          ) : items?.stage === "error" ? null : (
            <Text dimColor>{items?.stage === "loading" ? items.message : t.loading}</Text>
          )
        ) : (
          <Box flexDirection="column">
            {items.notes.map(note => (
              <Text key={note} dimColor>
                {note}
              </Text>
            ))}
            <Text dimColor>{items.items.length === 0 ? t.noItems : t.itemsHint}</Text>
            {items.items.map((item, index) => {
              // A review shows whether it is chosen with all its threads, in part, or not at all.
              const ids = idsOf(items.items, item.id)
              const count = ids.filter(id => items.chosen.includes(id)).length
              const mark = count === ids.length ? "x" : count > 0 ? "-" : " "
              const isUnfolded = unfolded.includes(item.id)
              return (
                <Box key={`row:${item.id}`} flexDirection="column" paddingLeft={item.parent === undefined ? 0 : 4}>
                  <Box>
                    <Button
                      key={`unfold:${item.id}`}
                      plain
                      label={isUnfolded ? "▾ " : "▸ "}
                      onPress={() => void update($, pickUnfolded, list => (list.includes(item.id) ? list.filter(one => one !== item.id) : [...list, item.id]))}
                    />
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
                  {isUnfolded && (
                    <Box paddingLeft={LOG_INDENT} flexDirection="column">
                      {shownContext(item.context).map((line, i) => (
                        <Text key={`said:${item.id}:${i}`} dimColor={line.isMeta}>
                          {plain(line.text) || " "}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        <Box flexWrap="wrap">
          {isItems && (
            <Button
              key="stage"
              hotkey="a"
              label={t.attach(items.chosen.length)}
              onPress={() => {
                // After the toggles pressed before it, so it stages what they chose.
                ctx.toggling = ctx.toggling.then(() => stageChosen($, ctx)).catch(() => undefined)
              }}
            />
          )}
          {ref !== null && <Button key="reload" hotkey="r" label={t.prReload} onPress={() => void showPull($, ctx, ref, true)} />}
          {toList}
          {close}
        </Box>
      </Box>
    )
  })

  // The band above the prompt: what is attached for the next prompt, then the open pull requests the person opened and
  // those asked of them to review, each group under its heading, each pull request a row its number links from.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const held = await read($, staged)
    const found = ctx.mine ? await read($, mine) : null
    // A group kept from before the band had groups is none.
    const groups = MINE_GROUPS.map(group => ({ group, pulls: found?.[group]?.pulls ?? [], more: found?.[group]?.more ?? 0 })).filter(one => one.pulls.length > 0)
    if (e.props.hasSurvey || (held.length === 0 && groups.length === 0)) return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const what = held.map(one => t.stagedOf(plain(pullLabel(one.pull)), one.items.length)).join(t.listSeparator)
    const size = stagedSize(held, ctx.language)
    // What the other mods draw stays, under this.
    const below = await next(e)
    /** One pull request's row: its number, who opened one asked of the person, where it stands, its title. */
    const row = (group: MineGroup, pull: GhMinePull) => {
      // That one asked of the person awaits their review goes without saying.
      const marks = statusText({ head: "", marks: statusMarks(t, pull.status, { awaiting: group === "requested" ? "none" : "any" }), latest: undefined }, false)
      const author = group === "requested" && pull.author !== undefined ? `  ${t.who(plain(pull.author))}` : ""
      return (
        <Text key={`${group}:${pull.key}`} wrap="truncate-end">
          {"  "}
          <Link href={plain(pull.url)}>{plain(pull.label)}</Link>
          {pull.status.isDraft === true ? t.paren(t.draft) : ""}
          {author}
          {marks === "" ? "" : `  ${marks}`}
          <Text dimColor>{`  ${plain(pull.title)}`}</Text>
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        {held.length > 0 && (
          <Box flexDirection="column">
            <Text>{t.staged(what)}</Text>
            {size > CONTEXT_LIMIT && <Text color="warning">{t.oversize(Math.round(size / 1000), CONTEXT_LIMIT / 1000)}</Text>}
            <Box>
              <Button
                key="gh-inbox-repick"
                label={t.repick}
                onPress={() => {
                  const ref = refOfPullKey(held[0]?.pull ?? "")
                  void (ref === null ? openList($, ctx) : openPull($, ctx, ref))
                }}
              />
              <Button key="gh-inbox-clear" label={t.detach} onPress={() => void update($, staged, () => [])} />
            </Box>
          </Box>
        )}
        {groups.map(({ group, pulls, more }, index) => {
          const shown = pulls.slice(0, MINE_SHOWN)
          return (
            <Box key={`gh-inbox-${group}`} flexDirection="column">
              {/* The first heading says whose band it is. */}
              <Text dimColor>{`${index === 0 ? "GitHub: " : ""}${t.mineHeading(group, shown.length, pulls.length + more)}`}</Text>
              {shown.map(pull => row(group, pull))}
            </Box>
          )
        })}
        {below}
      </Box>
    )
  })
}
