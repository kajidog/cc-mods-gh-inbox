import { atom, update } from "claude-code"
import type { EngineInterface, Register, Timer } from "claude-code"

import type { GhEvent, GhWatch } from "../types"

import { displayName, mergeSeen, newEvents, type Nicknames, pullIds } from "./events"
import { type PullRef, type PullState, parsePull, parsePullUrl, pullArgv, pullName } from "./github"

const COMMAND = "inbox"
const NICKNAMES_KEY = "nicknames"
const EVENTS_KEPT = 100
const SHOWN_AT_ONCE = 5
const TOAST_MS = 8000
// A branch with no open pull request is looked up again this often, not at every check.
const LOOKUP_MS = 5 * 60 * 1000
const MIN_INTERVAL_SECONDS = 30

const events = atom({ plugin: "gh-inbox", key: "events" } as const, [] as GhEvent[])
const watch = atom({ plugin: "gh-inbox", key: "watch" } as const, null as GhWatch | null)

type Found = { branch: string; ref: PullRef | null; state: PullState | null; lookedAt: number; isDone: boolean }
// What a module load keeps between checks; a reload starts it over.
type Context = { intervalSeconds: number; channel: string; notifySelf: boolean; found: Found | undefined; isChecking: boolean }

const seenKey = (ref: PullRef) => `seen:${ref.host}/${pullName(ref)}`

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
    if (/no (?:open )?pull requests? ctx.found/i.test(stderr)) return { branch, ref: null, state: null, lookedAt: now, isDone: false }
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
      // The same closed pull request ctx.found again has nothing more to say.
      if (before?.isDone && before.ref !== null && ctx.found.ref !== null && pullName(before.ref) === pullName(ctx.found.ref) && ctx.found.state !== "OPEN")
        ctx.found.isDone = true
    }
    const ref = ctx.found.ref
    if (ref === null) {
      await update($, watch, () => ({ branch, pull: null, title: null, url: null, state: null, checkedAt: now, error: null }))
      return
    }
    if (ctx.found.isDone) return

    const fetched = await $.process.run(pullArgv(ref))
    if (fetched.exitCode !== 0) throw new Error(firstLine(fetched.stderr) || `gh api exited with ${fetched.exitCode}`)
    const pull = parsePull(ref, fetched.stdout)

    const key = seenKey(ref)
    const stored = await $.store.get(key)
    const seen = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : undefined
    const nicknames = toNicknames(await $.store.get(NICKNAMES_KEY))
    const fresh = newEvents(pull, seen === undefined ? undefined : new Set(seen), { nicknames, notifySelf: ctx.notifySelf })
    await $.store.set(key, mergeSeen(seen ?? [], pullIds(pull)))

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
    if (seen === undefined && pull.state === "OPEN") $.ui.toast(`GitHub: #${ref.number} の通知を始めます。${pull.title}`, { timeoutMs: TOAST_MS })
    if (fresh.length > 0) {
      await update($, events, list => [...list, ...fresh].slice(-EVENTS_KEPT))
      await show($, ctx, fresh)
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

  return lines.join("\n")
}

export const register: Register = (on, options) => {
  const ctx: Context = {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, Number(options.intervalSeconds) || 60),
    channel: String(options.channel),
    notifySelf: options.notifySelf === true,
    found: undefined,
    isChecking: false,
  }
  let timer: Timer | undefined

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "GitHub notices for this branch's pull request: status, check now, recent notices, nicknames",
      argumentHint: "[status|check|log|nick [login [nickname]]]",
    })
    timer?.cancel()
    timer = $.clock.every(ctx.intervalSeconds * 1000, () => void check($, ctx))
    void check($, ctx)

    return next(e)
  })

  on("session.end", async ($, e, next) => {
    timer?.cancel()
    timer = undefined

    return next(e)
  })

  on("command.run", { command: COMMAND }, async ($, e) => {
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
