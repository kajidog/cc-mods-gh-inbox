import { atom, update } from "claude-code"
import type { EngineInterface, Register, Timer } from "claude-code"

import type { GhEvent, GhWatch } from "../types"

import { displayName, mergeSeen, newEvents, type Nicknames, pullIds } from "./events"
import { type PullRef, type PullState, parsePull, parsePullUrl, pullArgv, pullName } from "./github"
import { PRESENCE_PREFIX, type Presence, pickActive, toPresence } from "./presence"

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

const events = atom({ plugin: "gh-inbox", key: "events" } as const, [] as GhEvent[])
const watch = atom({ plugin: "gh-inbox", key: "watch" } as const, null as GhWatch | null)
const seenIds = atom({ plugin: "gh-inbox", key: "seen" } as const, {} as Record<string, string[]>)

type Found = { branch: string; ref: PullRef | null; state: PullState | null; lookedAt: number; isDone: boolean }
// What a module load keeps between checks; a reload starts it over.
type Context = {
  intervalSeconds: number
  channel: string
  notifySelf: boolean
  found: Found | undefined
  isChecking: boolean
  sessionId: string
  activeAt: number
  touchedAt: number
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
  const lines = shown.map(event => event.text)
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
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    if (key.startsWith(PRESENCE_PREFIX)) {
      const presence = toPresence(value)
      if (presence === undefined || now - presence.aliveAt > PRESENCE_KEPT_MS) await $.store.delete(key)
    } else if (key.startsWith(CACHE_PREFIX)) {
      const at = typeof value === "object" && value !== null ? (value as { at?: unknown }).at : undefined
      if (typeof at !== "number" || now - at > CACHE_KEPT_MS) await $.store.delete(key)
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

async function check($: EngineInterface, ctx: Context, isForced = false) {
  if (ctx.isChecking) return
  ctx.isChecking = true
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
    const key = pullKey(ref)
    const { value: seenByPull = {} } = await $.state.get({ plugin: "gh-inbox", key: "seen" })
    const seen = seenByPull[key]
    const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
    const fresh = newEvents(pull, seen === undefined ? undefined : new Set(seen), { nicknames, notifySelf: ctx.notifySelf })
    await update($, seenIds, held => ({ ...held, [key]: mergeSeen(held[key] ?? [], pullIds(pull)) }))

    if (pull.state !== "OPEN") ctx.found.isDone = true
    await update($, watch, () => ({
      branch,
      pull: pullName(ref),
      title: pull.title,
      url: pull.url,
      state: pull.state,
      checkedAt: now,
      error: null,
    }))
    await touch($, ctx, false)
    // Every session lists the notices; only the one touched last shows them.
    const isShown = await isShowing($, ctx, now)
    if (seen === undefined && pull.state === "OPEN" && isShown)
      $.ui.toast(`GitHub: #${ref.number} の通知を始めます。${pull.title}`, { timeoutMs: TOAST_MS })
    if (fresh.length > 0) {
      await update($, events, list => [...list, ...fresh].slice(-EVENTS_KEPT))
      if (isShown) await show($, ctx, fresh)
    }
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
  } finally {
    ctx.isChecking = false
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
  lines.push((await isShowing($, ctx, now)) ? "通知はこの窓に出します。" : "通知は最後に操作した別の窓に出します（/inbox log で一覧を見られます）。")

  return lines.join("\n")
}

export const register: Register = (on, options) => {
  const ctx: Context = {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, Number(options.intervalSeconds) || 60),
    channel: String(options.channel),
    notifySelf: options.notifySelf === true,
    found: undefined,
    isChecking: false,
    sessionId: "",
    activeAt: 0,
    touchedAt: 0,
  }
  let timer: Timer | undefined

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "GitHub notices for this branch's pull request: status, check now, recent notices, nicknames",
      argumentHint: "[status|check|log|nick [login [nickname]]]",
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
        return { text: list.slice(-20).map(event => `${event.text}\n  ${event.url}`).join("\n") }
      }
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
        return { text: "使い方: /inbox [status|check|log|nick [login [ニックネーム]]]" }
    }
  })
}
