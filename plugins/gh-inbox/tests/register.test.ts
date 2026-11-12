import type { On, RenderElement } from "claude-code"
import type { GhEvent } from "../types"
import { type Engine, expect, mock, test } from "claude-code/testing"

import { toKept } from "../hooks/history"
import { RUNS } from "./fixtures/repo-answers"

// Most tests read the Japanese lines; those in English, the default, are at the end.
const JA = { options: { language: "ja" } }
const KEY = "github.com/o/r"
const CHECK = { command: "inbox", args: "check", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 120 } } as const
const COMMENT = {
  id: "1",
  type: "IssueCommentEvent",
  actor: { login: "someone" },
  created_at: "2026-10-16T00:00:00Z",
  payload: {
    action: "created",
    issue: { number: 3, html_url: "https://github.com/o/r/pull/3", pull_request: {} },
    comment: { node_id: "IC_1", body: "Looks good", html_url: "u" },
  },
}

type Answer = { stdout?: string; stderr?: string; exitCode?: number }

/** Whether `argv` searches a host for the open pull requests the person opened, for the band above the prompt. */
const isMineSearch = (argv: readonly string[]) => (argv.at(-1) ?? "").includes("author:@me")
/** The search for the person's open pull requests finding none. */
const NO_PULLS_OF_MINE = JSON.stringify({ data: { viewer: { login: "me" }, opened: { issueCount: 0, nodes: [] }, requested: { issueCount: 0, nodes: [] } } })

/**
 * Answers `gh` as GitHub would for o/r: the events in `answers` one call after
 * another, then a `304` while the ETag asked with is the one last given.
 * `other` answers first where it returns something; the search for the person's
 * own pull requests is `mine`'s to answer, none found where it is not given.
 */
function fakeGitHub(
  on: On,
  answers: unknown[][],
  other: (argv: string[]) => Answer | undefined | Promise<Answer | undefined> = () => undefined,
  mine: (argv: string[]) => Answer = () => ({ stdout: NO_PULLS_OF_MINE }),
) {
  const asked: string[][] = []
  const toasts: string[] = []
  const logs: string[] = []
  let given = 0
  on("process.run", async (_$, e) => {
    const argv = [...e.argv]
    asked.push(argv)
    const done = (stdout: string, exitCode = 0, stderr = "") => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    const answered = isMineSearch(argv) ? mine(argv) : await other(argv)
    if (answered !== undefined) return done(answered.stdout ?? "", answered.exitCode ?? 0, answered.stderr ?? "")
    if (argv[0] === "git") return done("", 128)
    if (argv.includes("user")) return done("me\n")
    const path = argv.at(-1) ?? ""
    const etag = argv[argv.indexOf("-H") + 1]
    if (path.includes("/events")) {
      if (given >= answers.length && etag === `If-None-Match: "e${given}"`) return done(`HTTP/2.0 304 Not Modified\nEtag: "e${given}"\n\n`)
      const body = answers[given] ?? []
      given += 1
      return done(`HTTP/2.0 200 OK\nEtag: "e${given}"\nX-Poll-Interval: 60\n\n${JSON.stringify(body)}`)
    }
    if (path.includes("/actions/runs")) return done(`HTTP/2.0 200 OK\nEtag: "r"\n\n${JSON.stringify(RUNS)}`)
    return done("", 1)
  })
  on("ui.toast", async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on("ui.log", async (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })

  return { asked, toasts, logs }
}

test("a registered repository notifies only what came after its first look, and a 304 changes nothing", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment", "ci-failure"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], [COMMENT]])

  // The first look takes what is there as seen: the failed runs too.
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])

  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.logs).toEqual([])
  expect(github.toasts).toEqual(["[r] someoneさんが #3 にコメントしました。Looks good"])

  // Asked again with the ETag, GitHub answers 304: nothing more is notified or listed.
  const LOG = { ...CHECK, args: "log text" }
  const before = await $.command.run(LOG)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toHaveLength(1)
  expect(await $.command.run(LOG)).toEqual(before)
  expect(github.asked.filter(argv => argv.some(word => word.startsWith("If-None-Match")))).toHaveLength(4)
})

test("within the poll interval the shared answer is used, GitHub not asked", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]])

  await $.command.run(CHECK)
  await clock.advance(10_000)
  await $.command.run(CHECK)
  expect(github.asked.filter(argv => (argv.at(-1) ?? "").includes("/events"))).toHaveLength(1)
})

test("the picker turns kinds on and off, saved at once", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]])
  on("ui.open", async () => ({ value: { isPlaced: true } }))

  expect(await $.command.run({ ...CHECK, args: "repo set o/r" })).toEqual({ text: "ペインで種類を選べます。" })
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-kinds",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await pane.find({ key: "comment" }))?.props.label).toBe("[x] PR・Issue へのコメント（comment）")
  await pane.press({ key: "push" })
  await pane.press({ key: "comment" })
  expect((await pane.find({ key: "push" }))?.props.label).toBe("[x] push（push）")
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("o/r: push") })
})

test("the tray follows the picker: a repository with no kind left goes from it at once", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]])
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })

  await $.command.run({ ...CHECK, args: "repo set o/r" })
  expect(lines.at(-1)).toBe("GitHub: r -")
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-kinds",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  await pane.press({ key: "comment" })
  await $.command.run({ ...CHECK, args: "status" })
  expect(lines.at(-1)).toBeUndefined()
})

test("runs that cannot be read leave the other notices coming, the error shown", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment", "ci-failure"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const forbidden = { stderr: "gh: Resource not accessible by integration (HTTP 403)", exitCode: 1 }
  const github = fakeGitHub(on, [[], [COMMENT]], argv => ((argv.at(-1) ?? "").includes("/actions/runs") ? forbidden : undefined))

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r] someoneさんが #3 にコメントしました。Looks good"])
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("エラー: CI: gh: Resource not accessible") })
})

test("a repository with no kind chosen is not asked about", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: [] } } })
  mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]])

  await $.command.run(CHECK)
  expect(github.asked.filter(argv => (argv.at(-1) ?? "").includes("/events"))).toHaveLength(0)
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("種類を選ぶまで確認しません") })
})

test("a push whose compare fails for now is told at a later check, with its commits", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["push"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const push = {
    id: "2",
    type: "PushEvent",
    actor: { login: "someone" },
    created_at: "2026-10-16T00:00:00Z",
    payload: { ref: "refs/heads/main", before: "aaaaaaa", head: "bbbbbbb" },
  }
  let isDown = true
  const github = fakeGitHub(on, [[], [push]], argv => {
    if (!argv.some(word => word.includes("/compare/"))) return undefined
    if (isDown) return { stderr: "gh: Server Error (HTTP 502)", exitCode: 1 }
    return { stdout: JSON.stringify({ commits: [{ sha: "bbbbbbb", title: "fix: x", author: "someone" }], additions: 1, deletions: 2 }) }
  })

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])

  isDown = false
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r] someoneさんが main に push しました。fix: x (+1 −2)"])
})

test("a repository is registered as GitHub spells it and found whatever the case typed", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]], argv => (argv.includes(".id, .full_name") ? { stdout: "42\nOwner/Repo\n" } : undefined))

  expect(await $.command.run({ ...CHECK, args: "repo add owner/repo comment" })).toEqual({ text: "Owner/Repo を登録しました（PR・Issue へのコメント）。" })
  expect(await $.command.run({ ...CHECK, args: "repo add OWNER/REPO" })).toMatchObject({ text: expect.stringContaining("Owner/Repo は登録済みです") })
  expect(await $.command.run({ ...CHECK, args: "repo remove owner/repo" })).toEqual({ text: "Owner/Repo の登録を外しました。" })
})

test("while the login gh uses is not known, the repository waits instead of telling the person's own activity", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const mine = { ...COMMENT, actor: { login: "me" } }
  let isLoggedOut = true
  const github = fakeGitHub(on, [[], [mine]], argv => (argv.includes("user") && isLoggedOut ? { stderr: "gh: Bad credentials (HTTP 401)", exitCode: 1 } : undefined))

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  isLoggedOut = false
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
})

test("choosing ci-failure again asks for the runs before taking them as seen", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment", "ci-failure"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const failed = { id: 39000000003, name: "test", head_branch: "main", head_sha: "a12", html_url: "", updated_at: "2026-10-16T12:00:00Z", run_attempt: 1, conclusion: "failure" }
  let runs = RUNS
  const github = fakeGitHub(on, [[]], argv => {
    const path = argv.find(word => word.includes("/actions/runs")) ?? ""
    if (path.endsWith("/jobs")) return { stdout: JSON.stringify({ jobs: [] }) }
    if (path !== "") return { stdout: `HTTP/2.0 200 OK\nEtag: "r${runs.workflow_runs.length}"\n\n${JSON.stringify(runs)}` }
    return undefined
  })

  await $.command.run(CHECK)
  await $.command.run({ ...CHECK, args: "repo set o/r comment" })
  await clock.advance(10_000)
  await $.command.run(CHECK)
  // A run fails while CI notices are off; turned on again within the interval, it is taken as there already.
  runs = { ...RUNS, workflow_runs: [failed, ...RUNS.workflow_runs] }
  await $.command.run({ ...CHECK, args: "repo set o/r comment,ci-failure" })
  await clock.advance(10_000)
  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
})

test("titles are asked for in batches, so every notice has its own", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["pr-open"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const opened = Array.from({ length: 60 }, (_, index) => ({
    id: String(100 + index),
    type: "PullRequestEvent",
    actor: { login: "someone" },
    created_at: `2026-10-16T00:${String(index).padStart(2, "0")}:00Z`,
    payload: { action: "opened", number: index + 1, pull_request: { number: index + 1 } },
  }))
  const github = fakeGitHub(on, [[], opened.reverse()], argv => {
    const query = argv.find(word => word.startsWith("query=")) ?? ""
    if (!argv.includes("graphql")) return undefined
    const numbers = [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map(match => match[1])
    return { stdout: JSON.stringify({ data: { repository: Object.fromEntries(numbers.map(number => [`pr${number}`, { title: `t${number}`, author: null }])) } }) }
  })

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  const queries = github.asked.filter(argv => argv.includes("graphql") && !isMineSearch(argv)).map(argv => argv.at(-1) ?? "")
  expect(queries.map(query => query.match(/pullRequest\(/g)?.length)).toEqual([50, 10])
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("#60 t60") })
})

test("a repository whose name now leads to another one is not told about", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], id: 1 } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], [{ ...COMMENT, repo: { id: 2, name: "o/r" } }]])

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("別のリポジトリを指しています") })
})

test("the failed steps of at most a few runs are looked up at one check, the rest told without", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["ci-failure"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const run = (id: number) => ({ id, name: "test", head_branch: "main", head_sha: "a", html_url: "", updated_at: "", run_attempt: 1, conclusion: "failure" })
  let runs: unknown[] = []
  const github = fakeGitHub(on, [[]], argv => {
    const path = argv.find(word => word.includes("/actions/runs")) ?? ""
    if (path.endsWith("/jobs")) return { stdout: JSON.stringify({ jobs: [] }) }
    if (path !== "") return { stdout: `HTTP/2.0 200 OK\nEtag: "r${runs.length}"\n\n${JSON.stringify({ workflow_runs: runs })}` }
    return undefined
  })

  await $.command.run(CHECK)
  runs = Array.from({ length: 8 }, (_, index) => run(index + 1))
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.asked.filter(argv => argv.some(word => word.endsWith("/jobs")))).toHaveLength(5)
  expect((await $.command.run({ ...CHECK, args: "log text" })).text?.match(/CI が失敗しました/g)).toHaveLength(8)
})

test("a hook on inbox.notify sees each notice first, rewrites what shows or keeps it from showing, and the log keeps it", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], [COMMENT, { ...COMMENT, id: "2", actor: { login: "bot" }, payload: { ...COMMENT.payload, comment: { ...COMMENT.payload.comment, node_id: "IC_2" } } }]])
  const heard: unknown[] = []
  on("inbox.notify", async (_$, e, next) => {
    heard.push(e)
    if (e.event.author === "bot") return { deny: "muted" }
    return next({ ...e, text: `${e.text}!` })
  })

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(heard).toEqual([
    expect.objectContaining({ event: expect.objectContaining({ kind: "comment", pull: "o/r#3", author: "bot" }) }),
    expect.objectContaining({ source: "repo", repo: KEY, label: "r", isSelf: false, text: "[r] someoneさんが #3 にコメントしました。Looks good" }),
  ])
  expect(github.toasts).toEqual(["[r] someoneさんが #3 にコメントしました。Looks good!"])
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("botさん") })
})

test("inbox.notified tells each notice no hook refused, as it shows, once every hook on inbox.notify answered", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const BOT = { ...COMMENT, id: "2", actor: { login: "bot" }, payload: { ...COMMENT.payload, comment: { ...COMMENT.payload.comment, node_id: "IC_2" } } }
  fakeGitHub(on, [[], [COMMENT, BOT]])
  const told: string[] = []
  on("inbox.notified", async (_$, e, next) => {
    told.push(e.text)
    return next(e)
  })
  // Refused and rewritten on the way back up, after every hook beneath has answered.
  on("inbox.notify", async (_$, e, next) => {
    const result = await next(e)
    const notice = "value" in result ? result.value : undefined
    if (notice === undefined) return result
    if (notice.event.author === "bot") return { deny: "muted" }
    return { value: { ...notice, text: `${notice.text}\u001b[31m!` } }
  })

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  // As it shows: the escape a hook wrote loses its control character.
  expect(told).toEqual(["[r] someoneさんが #3 にコメントしました。Looks good[31m!"])
})

test("at a session's first look, what came since another session last looked is listed, not shown", JA, async ($, on) => {
  // Another session looked at o/r before this one opened, and saw nothing then.
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } }, [`shared-seen:repo:${KEY}`]: { at: 999_000, ids: [] } })
  const now = Date.parse("2026-10-17T00:00:00Z")
  const clock = mock.clock(on, { now })
  const github = fakeGitHub(on, [[COMMENT], []])

  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["GitHub: どの窓も見ていなかったあいだの通知が1件あります（/inbox log）"])
  expect(await $.command.run({ ...CHECK, args: "log text" })).toEqual({
    text: "[r] someoneさんが #3 にコメントしました。Looks good\n  u（1日前）",
  })

  // Seen now: the next check tells nothing of it.
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toHaveLength(1)
})

test("at a first look while another session is alive, what it has not told yet is notified as it comes", JA, async ($, on) => {
  const now = Date.parse("2026-10-17T00:00:00Z")
  mock.store(on, {
    repos: { [KEY]: { kinds: ["comment"], alias: "r" } },
    [`shared-seen:repo:${KEY}`]: { at: now - 30_000, ids: [] },
    // Alive, but touched before this one opened: this one shows.
    "presence:other": { activeAt: now - 600_000, aliveAt: now - 30_000 },
    "presence:": { activeAt: now, aliveAt: now },
  })
  mock.clock(on, { now })
  const github = fakeGitHub(on, [[COMMENT]])

  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r] someoneさんが #3 にコメントしました。Looks good"])
})

test("at a first look while another session is alive and showing, what it has not listed yet is left for it to tell how many", JA, async ($, on) => {
  const now = Date.parse("2026-10-17T00:00:00Z")
  mock.store(on, {
    repos: { [KEY]: { kinds: ["comment"], alias: "r" } },
    [`shared-seen:repo:${KEY}`]: { at: now - 30_000, ids: [] },
    // Touched after this one: that one shows.
    "presence:other": { activeAt: now, aliveAt: now },
    "presence:": { activeAt: now - 600_000, aliveAt: now },
  })
  mock.clock(on, { now })
  const github = fakeGitHub(on, [[COMMENT]])

  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("Looks good") })
})

test("what a session caught up while another showed is told by the one showing, once", JA, async ($, on) => {
  // One left before what the log keeps is dropped.
  mock.store(on, { "missed:other": { at: 1_000_000, count: 2 }, "missed:old": { at: 1_000_000 - 31 * 24 * 60 * 60 * 1000, count: 5 } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]])

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["GitHub: どの窓も見ていなかったあいだの通知が2件あります（/inbox log）"])
})

for (const registered of [true, false]) {
  test(`a repository registered again starts from a first look, not from what was seen before (${registered ? "removed here" : "written back by another window"})`, JA, async ($, on) => {
    // Seen ids from before, while it was registered.
    mock.store(on, { ...(registered ? { repos: { [KEY]: { kinds: ["comment"] } } } : {}), [`shared-seen:repo:${KEY}`]: { at: 999_000, ids: [] } })
    const clock = mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on, [[COMMENT], []], argv => (argv.includes(".id, .full_name") ? { stdout: "42\no/r\n" } : undefined))

    if (registered) await $.command.run({ ...CHECK, args: "repo remove o/r" })
    expect(await $.command.run({ ...CHECK, args: "repo add o/r comment" })).toMatchObject({ text: expect.stringContaining("o/r") })
    await clock.advance(61_000)
    await $.command.run(CHECK)
    expect(github.toasts).toEqual([])
    expect(github.asked.some(argv => (argv.at(-1) ?? "").includes("/events"))).toBe(true)
  })
}

test("a notice with no time of its own is listed as of when it was seen, not behind every other", JA, async ($, on) => {
  const now = Date.parse("2026-10-17T00:00:00Z")
  const old = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, kind: "comment", pull: "o/r#1", author: "a", at: "2026-10-16T00:00:00Z", text: `old${i}`, url: "u", items: [] }))
  mock.store(on, {
    // This session's notices are read before the other's, so nothing before them lends them a time.
    "history:": { at: 1, events: [] },
    "history:other": { at: 1, events: old },
    repos: { [KEY]: { kinds: ["comment"], alias: "r" } },
    [`shared-seen:repo:${KEY}`]: { at: now - 30_000, ids: [] },
  })
  mock.clock(on, { now })
  fakeGitHub(on, [[{ ...COMMENT, created_at: "" }]])

  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("Looks good") })
})

test("of more sessions than are kept, those whose notices are newest are kept, not those written to last", JA, async ($, on) => {
  const now = Date.parse("2026-10-17T00:00:00Z")
  const one = (id: string, at: string) => ({ id, kind: "comment", pull: "o/r#1", author: "a", at, text: id, url: "u", items: [] })
  // Written to first, but holding the newest notice.
  const histories: Record<string, unknown> = { "history:late": { at: now - 3_600_000, events: [one("newest", "2026-10-16T23:00:00Z")] } }
  for (let i = 0; i < 20; i += 1) histories[`history:s${i}`] = { at: now - 60_000, events: [one(`old${i}`, "2026-10-01T00:00:00Z")] }
  mock.store(on, histories)
  mock.clock(on, { now })
  fakeGitHub(on, [[]])
  on("command.register", async (_$, e) => ({ value: { command: e.name } }))
  on("session.id", async () => ({ value: "s1" }))
  on("session.start", async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true })
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("newest") })
})

test("/inbox log lists what other sessions listed", JA, async ($, on) => {
  const event = { id: "x", kind: "comment", pull: "o/r#3", author: "a", at: "2026-10-16T23:00:00Z", text: "elsewhere", url: "u", items: [] }
  mock.store(on, { "history:other": { at: 1, events: [event] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  expect(await $.command.run({ ...CHECK, args: "log text" })).toEqual({ text: "elsewhere\n  u（1時間前）" })
})

test("/inbox log opens a pane of every notice kept, newest first, a page at a time, and lists nothing in the transcript", JA, async ($, on) => {
  const events = Array.from({ length: 23 }, (_, i) => ({
    id: `c${i}`,
    kind: "comment",
    pull: "o/r#3",
    author: "a",
    at: new Date(Date.parse("2026-10-16T00:00:00Z") + i * 60_000).toISOString(),
    text: `n${i}`,
    url: `https://github.com/o/r/pull/3#c${i}`,
    items: [],
  }))
  mock.store(on, { "history:other": { at: 1, events } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])
  const opened: unknown[] = []
  let hasRoom = true
  on("ui.open", async (_$, e) => {
    opened.push(e.id)
    return { value: hasRoom ? { isPlaced: true } : { isPlaced: false, reason: "no room" } }
  })

  expect(await $.command.run({ ...CHECK, args: "log" })).toEqual({ text: "ログをペインで開きました（23件）。" })
  expect(opened).toEqual(["gh-inbox-log"])
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-log",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: "Text", text: "23件中 1〜10件目（新しい順）" })).toBeDefined()
  expect((await pane.findAll({ type: "Link" })).map(link => link.props.href).at(0)).toBe("https://github.com/o/r/pull/3#c22")
  expect(await pane.find({ key: "newer" })).toBeUndefined()
  await pane.press({ key: "older" })
  await pane.press({ key: "older" })
  expect(await pane.find({ type: "Text", text: "23件中 21〜23件目（新しい順）" })).toBeDefined()
  expect((await pane.findAll({ type: "Link" })).map(link => link.props.href)).toEqual([
    "https://github.com/o/r/pull/3#c2",
    "https://github.com/o/r/pull/3#c1",
    "https://github.com/o/r/pull/3#c0",
  ])
  expect(await pane.find({ key: "older" })).toBeUndefined()
  await pane.press({ key: "newer" })
  expect(await pane.find({ type: "Text", text: "23件中 11〜20件目（新しい順）" })).toBeDefined()

  // Where no pane opens, the newest are listed as text.
  hasRoom = false
  expect((await $.command.run({ ...CHECK, args: "log" })).text?.split("\n")).toHaveLength(40)
})

test("a row of the log pane with more to say unfolds to all of it, line comments with their places, and folds back", JA, async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const review = {
    id: "PRR_1",
    kind: "review",
    pull: "o/r#3",
    author: "a",
    at,
    text: "aさんが変更をリクエストしました（コメント1件）。Rename this",
    url: "https://github.com/o/r/pull/3#r1",
    items: [
      { body: "Rename this\nand that", url: "https://github.com/o/r/pull/3#r1" },
      { body: "Use undefined", path: "src/a.ts", line: 12, hunk: "@@", url: "https://github.com/o/r/pull/3#c1" },
    ],
  }
  const short = { id: "c2", kind: "comment", pull: "o/r#3", author: "b", at, text: "bさんがコメントしました。ok", url: "u", items: [{ body: "ok", url: "u" }] }
  mock.store(on, { "history:other": toKept([review, short] as GhEvent[], 1) })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])
  on("ui.open", async () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...CHECK, args: "log" })
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-log",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  // Newest first, the two at the same time in the order they came: the review is the first, the comment says it all.
  const unfold = await pane.find({ key: "unfold:o/r#3|PRR_1" })
  expect(unfold?.props.label).toBe("▸ ")
  expect(unfold?.props.hotkey).toBe("2")
  expect(await pane.find({ key: "unfold:o/r#3|c2" })).toBeUndefined()
  expect(await pane.find({ type: "Text", text: "and that" })).toBeUndefined()

  await pane.press({ key: "unfold:o/r#3|PRR_1" })
  expect((await pane.find({ key: "unfold:o/r#3|PRR_1" }))?.props.label).toBe("▾ ")
  expect(await pane.find({ type: "Text", text: "and that" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "src/a.ts:12" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "Use undefined" })).toBeDefined()

  await pane.press({ key: "unfold:o/r#3|PRR_1" })
  expect(await pane.find({ type: "Text", text: "and that" })).toBeUndefined()
})

test("the log pane narrows to one repository by its buttons, `r` or /inbox log <repository>", JA, async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const event = (id: string, pull: string, text: string, label?: string) => ({ id, kind: "comment", pull, author: "a", at, text, url: "u", items: [], ...(label === undefined ? {} : { label }) })
  mock.store(on, {
    "history:other": toKept(
      [event("c1", "o/r#3", "aさんがコメントしました。in r"), event("c2", "o/other", "[oth] aさんがプッシュしました。in other", "oth")] as GhEvent[],
      1,
    ),
    repos: { "github.com/o/r": { kinds: ["comment"], alias: "rr" } },
  })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])
  on("ui.open", async () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...CHECK, args: "log" })
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-log",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  // All first; the registered repository by its alias, the other by the label its notice was made with.
  expect((await pane.find({ key: "repo:" }))?.props.label).toBe("[すべて]")
  expect((await pane.find({ key: "repo:o/r" }))?.props.label).toBe(" rr ")
  expect((await pane.find({ key: "repo:o/other" }))?.props.label).toBe(" oth ")
  expect(await pane.find({ type: "Text", text: "2件中 1〜2件目（新しい順）" })).toBeDefined()

  await pane.press({ key: "repo:o/r" })
  expect((await pane.find({ key: "repo:o/r" }))?.props.label).toBe("[rr]")
  expect(await pane.find({ type: "Text", text: "1件中 1〜1件目（新しい順）" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "in other" })).toBeUndefined()
  // `r` goes on to the next one, newest first; after the last, back to all.
  expect((await pane.find({ key: "repo:" }))?.props.hotkey).toBe("r")
  await pane.press({ key: "repo:" })
  expect((await pane.find({ key: "repo:o/other" }))?.props.hotkey).toBe("r")

  expect(await $.command.run({ ...CHECK, args: "log Other" })).toMatchObject({ text: "ログをペインで開きました（1件）。" })
  expect((await pane.find({ key: "repo:o/other" }))?.props.label).toBe("[oth]")
  expect(await $.command.run({ ...CHECK, args: "log nope" })).toMatchObject({ text: expect.stringContaining("nope というリポジトリ") })
  const text = await $.command.run({ ...CHECK, args: "log rr text" })
  expect(text).toMatchObject({ text: expect.stringContaining("in r") })
  expect(text).not.toMatchObject({ text: expect.stringContaining("in other") })
})

test("a commit or push row of the log pane unfolds to its commits under its line counts, which stay", JA, async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const commits = ["one", "two", "three", "four"].map(title => ({ body: title, url: `https://github.com/o/r/commit/${title}` }))
  const commit = { id: "c4", kind: "commit", pull: "o/r#3", author: "a", at, text: "aさんがコミットしました。one / two / three ほか1件 (+4 −2)", url: "u", items: commits }
  // Its own commits: one telling the same commits as another is listed once.
  const push = {
    ...commit,
    id: "event:1",
    kind: "push",
    pull: "o/r",
    text: "aさんが main に push しました。one / two / three ほか1件 (+4 −2)",
    items: commits.map(one => ({ ...one, url: `${one.url}-pushed` })),
  }
  mock.store(on, { "history:other": toKept([commit, push] as GhEvent[], 1) })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])
  on("ui.open", async () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...CHECK, args: "log" })
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-log",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  await pane.press({ key: "unfold:o/r#3|c4" })
  await pane.press({ key: "unfold:o/r|event:1" })
  // Each row's line counts: the line and the Text that colors its counts read the same.
  expect((await pane.findAll({ type: "Text", text: "one / two / three ほか1件 (+4 −2)" })).length).toBe(4)
  expect((await pane.findAll({ type: "Text", text: "・four" })).length).toBe(2)
  const colored = (await pane.findAll({ type: "Text" })).filter(one => one.props.color === "success" || one.props.color === "error")
  expect(colored.map(one => one.children.join(""))).toEqual(["+4", "−2", "+4", "−2"])
})

test("/inbox log's row draws the repository's short name in color and what was done as a link, when it happened beside it", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]])
  // The engine's own row, beneath the plugin.
  on("ui.render", { component: "CommandOutput" }, async (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return h(Text, null, "engine's own") as RenderElement
  })
  const row = (args: string, text: string) =>
    $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "CommandOutput", props: { command: "inbox", args, text, isErrored: false } })

  const log = await row(
    "log",
    "[r] aさんが #3 にコメントしました。Looks good\n  https://github.com/o/r/pull/3（1日前）\nno url\n  （3日前）\n#4 がマージされました。\n  https://github.com/o/r/pull/4 (2h ago)",
  )
  const links = await log.findAll({ type: "Link" })
  expect(links.map(link => [link.props.href, link.children.join("")])).toEqual([
    ["https://github.com/o/r/pull/3", "#3 にコメントしました"],
    ["https://github.com/o/r/pull/4", "#4 がマージされました"],
  ])
  const colored = (await log.findAll({ type: "Text" })).filter(text => text.props.color !== undefined && text.props.color !== "claude")
  expect(colored.map(text => [text.props.color, text.children.join("")])).toEqual([["suggestion", "[r]"]])
  // Who did it and what, bold in its own color, set apart from what they said.
  const heads = (await log.findAll({ type: "Text" })).filter(text => text.props.color === "claude")
  expect(heads.map(text => text.props.bold)).toEqual([true, true, true])
  expect(await log.find({ type: "Text", text: "（1日前）" })).toBeDefined()
  expect(await log.find({ type: "Text", text: " (2h ago)" })).toBeDefined()
  // What was said goes under who did what, the "。" between them not drawn; a notice with nothing said has no second line.
  expect(await log.find({ type: "Text", text: "[r] aさんが https://github.com/o/r/pull/3#3 にコメントしました（1日前）" })).toBeDefined()
  expect(await log.find({ type: "Text", text: "Looks good" })).toBeDefined()
  expect(await log.find({ type: "Text", text: "https://github.com/o/r/pull/4#4 がマージされました (2h ago)" })).toBeDefined()
  expect(await log.find({ type: "Text", text: "。" })).toBeUndefined()
  // One with no URL is drawn as text, the others still links.
  expect(await log.find({ type: "Text", text: "no url（3日前）" })).toBeDefined()

  // Any other row is the engine's own.
  expect(await (await row("log", "通知はまだありません。")).find({ text: "engine's own" })).toBeDefined()
  expect(await (await row("status", "[r] a\n  https://x")).find({ text: "engine's own" })).toBeDefined()
})

test("/inbox log draws a push's changed line counts in color, signs and all, not a comment's words of the same shape", async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const push = { id: "p", kind: "push", pull: "o/r#3", author: "a", at, text: "a pushed to main: fix (+1 −2) again (+15 −10)", url: "https://github.com/o/r/commit/x", items: [] }
  const comment = { id: "c", kind: "comment", pull: "o/r#3", author: "b", at, text: "b commented on #3: please keep (+1 −2)", url: "https://github.com/o/r/pull/3", items: [] }
  mock.store(on, { "history:other": { at: 1, events: [push, comment] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  const { text = "" } = await $.command.run({ ...CHECK, args: "log text" })
  const log = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "CommandOutput", props: { command: "inbox", args: "log text", text, isErrored: false } })
  const colored = (await log.findAll({ type: "Text" })).filter(one => one.props.color !== undefined && one.props.color !== "claude")
  expect(colored.map(one => [one.props.color, one.children.join("")])).toEqual([
    ["success", "+15"],
    ["error", "−10"],
  ])
  // Under who did what, the ": " between them not drawn.
  expect(await log.find({ type: "Text", text: "fix (+1 −2) again (+15 −10)" })).toBeDefined()
})

test("/inbox log links what was done and colors the short name, a person's own words not taken for either", async ($, on) => {
  const event = {
    id: "x",
    kind: "comment",
    pull: "o/r#3",
    author: "a",
    who: "Team commented",
    head: "Team commented commented on #3",
    label: "x] y",
    at: "2026-10-16T23:00:00Z",
    text: "[x] y] Team commented commented on #3: hi",
    url: "https://github.com/o/r/pull/3",
    items: [],
  }
  mock.store(on, { "history:other": { at: 1, events: [event] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  const { text = "" } = await $.command.run({ ...CHECK, args: "log text" })
  const log = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "CommandOutput", props: { command: "inbox", args: "log text", text, isErrored: false } })
  const links = await log.findAll({ type: "Link" })
  expect(links.map(link => link.children.join(""))).toEqual(["commented on #3"])
  // A short name with "]" in it is colored whole.
  const colored = (await log.findAll({ type: "Text" })).filter(one => one.props.color !== undefined && one.props.color !== "claude")
  expect(colored.map(one => one.children.join(""))).toEqual(["[x] y]"])
})

test("/inbox log does not color a nickname in brackets on a notice with no short name", async ($, on) => {
  const event = { id: "x", kind: "comment", pull: "o/r#3", author: "a", who: "[bot]", head: "[bot] commented", at: "2026-10-16T23:00:00Z", text: "[bot] commented: hi", url: "u", items: [] }
  mock.store(on, { "history:other": { at: 1, events: [event] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  const { text = "" } = await $.command.run({ ...CHECK, args: "log text" })
  const log = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "CommandOutput", props: { command: "inbox", args: "log text", text, isErrored: false } })
  expect((await log.findAll({ type: "Text" })).filter(one => one.props.color !== undefined && one.props.color !== "claude")).toEqual([])
  expect((await log.findAll({ type: "Link" })).map(link => link.children.join(""))).toEqual(["commented"])
})

const ROW = { options: { language: "ja", channel: "row" } }
/** COMMENT with the URL GitHub gives a comment. */
const LINKED = { ...COMMENT, payload: { ...COMMENT.payload, comment: { ...COMMENT.payload.comment, html_url: "https://github.com/o/r/pull/3#issuecomment-1" } } }
/** Six comments, more than are shown one by one at a check. */
const SIX = Array.from({ length: 6 }, (_, i) => ({
  ...COMMENT,
  id: `${i + 1}`,
  payload: { ...COMMENT.payload, comment: { ...COMMENT.payload.comment, node_id: `IC_${i + 1}`, body: `c${i + 1}` } },
}))

/** Answers `$.ui.place` as a surface that draws rows does, and keeps the ids placed. */
function rowsPlaced(on: On) {
  const ids: string[] = []
  on("ui.place", async (_$, e) => {
    ids.push(e.id)
    return { value: { isPlaced: true as const, requestId: e.id } }
  })
  return ids
}

test("the row channel places each notice in the transcript, drawn as the log draws it, what was done a link to it", ROW, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], [LINKED]])
  const ids = rowsPlaced(on)
  // What is beneath the plugin draws a row it leaves.
  on("ui.render", { component: "Placed" }, async (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return h(Text, null, "beneath") as RenderElement
  })
  const row = (id: string, plugin = "gh-inbox") => $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Placed", props: { id, plugin } })

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(ids).toHaveLength(1)
  expect(github.toasts).toEqual([])
  expect(github.logs).toEqual([])

  const [id = ""] = ids
  const drawn = await row(id)
  const links = await drawn.findAll({ type: "Link" })
  expect(links.map(link => [link.props.href, link.children.join("")])).toEqual([["https://github.com/o/r/pull/3#issuecomment-1", "#3 にコメントしました"]])
  const dim = (await drawn.findAll({ type: "Text" })).filter(text => text.props.dimColor === true)
  expect(dim.map(text => text.children.join(""))).toEqual(["GitHub: "])
  expect((await drawn.findAll({ type: "Text" })).filter(text => text.props.color === "suggestion").map(text => text.children.join(""))).toEqual(["[r]"])
  expect(await drawn.find({ type: "Text", text: "Looks good" })).toBeDefined()
  // The apps draw it too, the link the same.
  for (const surface of ["desktop", "mobile"] as const) {
    const app = await $.ui.mount({ plugin: "gh-inbox", surface, component: "Placed", props: { id, plugin: "gh-inbox" } })
    expect((await app.findAll({ type: "Link" })).map(link => link.props.href)).toEqual(["https://github.com/o/r/pull/3#issuecomment-1"])
  }

  // Another plugin's row, and one this plugin keeps nothing for, are left to what is beneath.
  expect(await (await row(id, "other")).find({ text: "beneath" })).toBeDefined()
  expect(await (await row("gone")).find({ text: "beneath" })).toBeDefined()
})

test("the row channel counts what is not shown one by one on a dim row of its own, with no link", ROW, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[], SIX])
  const ids = rowsPlaced(on)

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(ids).toHaveLength(5)
  expect(new Set(ids).size).toBe(5)

  const more = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Placed", props: { id: ids.at(-1) ?? "", plugin: "gh-inbox" } })
  expect(await more.find({ type: "Link" })).toBeUndefined()
  const dim = (await more.findAll({ type: "Text" })).filter(text => text.props.dimColor === true)
  expect(dim.map(text => text.children.join(""))).toEqual(["GitHub: ほか2件の更新があります（/inbox log）"])
})

test("where Claude Code places no rows, the row channel writes the dim lines log does, GitHub: said once", ROW, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  // No hook answers `ui.place`, as on a Claude Code before rows.
  const github = fakeGitHub(on, [[], SIX])

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
  expect(github.logs).toHaveLength(5)
  expect(github.logs.slice(0, 4).every(line => /^GitHub: \[r\] someoneさんが #3 にコメントしました。c\d$/.test(line))).toBe(true)
  expect(github.logs.at(-1)).toBe("GitHub: ほか2件の更新があります（/inbox log）")
})

test("the log channel says GitHub: once on the line counting what is not shown one by one", { options: { language: "ja", channel: "log" } }, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], SIX])

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])
  expect(github.logs.at(-1)).toBe("GitHub: ほか2件の更新があります（/inbox log）")
})

test("/inbox repo tells when each repository's last event happened", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  fakeGitHub(on, [[COMMENT]], argv => ((argv.at(-1) ?? "").includes("/actions/runs") ? { stdout: 'HTTP/2.0 200 OK\nEtag: "r"\n\n{"workflow_runs":[]}' } : undefined))

  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("最後の確認: 0秒前、最後のイベント: 5分前") })
})

test("the tray under the prompt tells how long ago each repository's last event happened, kept up each check", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" }, "github.com/o/quiet": { kinds: ["push"] }, "github.com/o/off": { kinds: [] } } })
  const clock = mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  fakeGitHub(on, [[COMMENT]], argv => {
    const path = argv.at(-1) ?? ""
    if (path.includes("/actions/runs")) return { stdout: 'HTTP/2.0 200 OK\nEtag: "r"\n\n{"workflow_runs":[]}' }
    if (path.includes("o/quiet/events")) return { stdout: 'HTTP/2.0 200 OK\nEtag: "q"\n\n[]' }
    return undefined
  })
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })

  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: r 5分前 | quiet -")
  await clock.advance(55 * 60_000)
  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: r 1時間前 | quiet -")
  await $.command.run({ ...CHECK, args: "repo remove o/r" })
  expect(lines.at(-1)).toBe("GitHub: quiet -")
  await $.command.run({ ...CHECK, args: "repo remove o/quiet" })
  expect(lines.at(-1)).toBeUndefined()
})

/** `gh` and `git` answering for a branch whose pull request is o/r#12, as `PULL_QUERY` would. */
function branchPull(at: string) {
  const answer = {
    data: {
      viewer: { login: "me" },
      repository: {
        pullRequest: {
          title: "Add things",
          url: "https://github.com/o/r/pull/12",
          state: "OPEN",
          closedAt: null,
          mergeable: "CONFLICTING",
          reviewDecision: "APPROVED",
          mergedBy: null,
          latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "bob" } }, { state: "APPROVED", author: { login: "carol" } }] },
          comments: { nodes: [{ id: "c1", author: { login: "alice" }, body: "Looks good", createdAt: at, url: "u" }] },
          reviews: { nodes: [] },
          commits: { nodes: [] },
          latest: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    state: "FAILURE",
                    contexts: {
                      nodes: [
                        { __typename: "CheckRun", databaseId: 1, name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "", steps: { nodes: [] } },
                        { __typename: "CheckRun", databaseId: 2, name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "", steps: { nodes: [] } },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  }
  return (argv: string[]): Answer | undefined => {
    if (argv[0] === "git") return { stdout: "feat\n" }
    if (argv.includes("pr") && argv.includes("view")) return { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/12", state: "OPEN" }) }
    if (argv.includes("graphql")) return { stdout: JSON.stringify(answer) }
    return undefined
  }
}

test("the tray tells where the branch's pull request stands, and /inbox tray switches to the repositories", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  fakeGitHub(on, [[COMMENT]], argv => {
    if ((argv.at(-1) ?? "").includes("/actions/runs")) return { stdout: 'HTTP/2.0 200 OK\nEtag: "r"\n\n{"workflow_runs":[]}' }
    return branchPull(COMMENT.created_at)(argv)
  })
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })

  const PULL_LINE = "GitHub: #12  ✗ コンフリクト  ✗ CI 1/2  ✓ 承認2 | aliceさん「Looks good」5分前"
  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe(PULL_LINE)
  // `/inbox` names who approved; the line under the prompt counts them.
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({
    text: expect.stringContaining("\n  ✗ コンフリクト  ✗ CI 1/2  ✓ 承認（bobさん、carolさん） | aliceさん「Looks good」5分前\n"),
  })

  expect(await $.command.run({ ...CHECK, args: "tray" })).toMatchObject({ text: expect.stringContaining("登録したリポジトリの一覧を出します") })
  expect(lines.at(-1)).toBe("GitHub: r 5分前")
  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: r 5分前")
  await $.command.run({ ...CHECK, args: "tray pull" })
  expect(lines.at(-1)).toBe(PULL_LINE)
  expect(await $.command.run({ ...CHECK, args: "tray other" })).toEqual({ text: "使い方: /inbox tray [pull|repos]（省くと切り替えます）" })
})

test("with no repository registered, the tray tells of the branch's pull request whichever is chosen", async ($, on) => {
  mock.store(on, { trayView: "repos" })
  mock.clock(on, { now: Date.parse(COMMENT.created_at) + 2 * 3600_000 })
  fakeGitHub(on, [[]], branchPull(COMMENT.created_at))
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })

  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: #12  ✗ conflicts  ✗ CI 1/2  ✓ 2 approvals | alice “Looks good” 2h ago")
})

test("a branch switched to shows by the next prompt sent, GitHub asked only when it changed", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  let branch = "feat"
  const pull = branchPull(COMMENT.created_at)
  const github = fakeGitHub(on, [[]], argv => {
    if (argv[0] === "git") return { stdout: `${branch}\n` }
    if (branch === "main" && argv.includes("pr")) return { exitCode: 1, stderr: 'no pull requests found for branch "main"' }
    return pull(argv)
  })
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on("prompt.submit", async (_$, e) => ({ text: e.text }))
  const toGitHub = () => github.asked.filter(argv => argv[0] === "gh").length

  await $.command.run(CHECK)
  expect(lines.at(-1)).toContain("#12")
  const asked = toGitHub()
  await $.prompt.submit({ text: "続けて", wait: false, origin: { kind: "composer" } })
  expect(toGitHub()).toBe(asked)

  branch = "main"
  await $.prompt.submit({ text: "続けて", wait: false, origin: { kind: "composer" } })
  // The check runs behind the prompt, which does not wait for it.
  for (let tries = 0; tries < 100 && lines.at(-1) !== undefined; tries += 1) await $.command.run({ ...CHECK, args: "status" })
  expect(lines.at(-1)).toBeUndefined()
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({ text: expect.stringContaining("main の PR はありません。") })
})

test("the tray can be turned off", { options: { language: "ja", tray: false } }, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[COMMENT]])
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })

  await $.command.run(CHECK)
  expect(lines.every(line => line === undefined)).toBe(true)
})

test(
  "/inbox alone tells where things stand, each setting as it is now and the commands; /inbox status where things stand alone",
  { options: { language: "ja", channel: "row", intervalSeconds: 10, myPulls: false } },
  async ($, on) => {
    mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
    mock.clock(on, { now: 1_000_000 })
    fakeGitHub(on, [[]])
    on("ui.status", async () => ({ value: undefined }))

    await $.command.run(CHECK)
    await $.command.run({ ...CHECK, args: "tray repos" })
    const status = (await $.command.run({ ...CHECK, args: "status" }))?.text ?? ""
    expect(status).toContain("\n登録したリポジトリ: 1件（/inbox repo）")
    expect(status).not.toContain("設定")
    // Each value where the longest name ends, as a terminal draws them, Japanese two cells a letter.
    expect(await $.command.run({ ...CHECK, args: "" })).toEqual({
      text: [
        status,
        "",
        "設定（/config の「GitHub: …」で変えます）",
        "  確認の間隔                 30秒",
        "  通知の出し方               row",
        "  言語                       ja",
        "  プロンプトの下の行         オン・登録したリポジトリ（/inbox tray で切り替え）",
        "  入力欄の上の PR            オフ",
        "  CI の結果を Claude に渡す  オン",
        "  自分の操作も通知           オフ",
        "  登録できるリポジトリ       20件",
        "",
        "コマンド",
        "  /inbox check  今すぐ確認する",
        "  /inbox log    通知の一覧",
        "  /inbox pr     PR の一覧・詳細・操作",
        "  /inbox repo   リポジトリの登録",
        "  /inbox nick   表示名を短くする",
        "  /inbox tray   プロンプトの下の行を切り替える",
        "  /inbox clear  添付を外す",
      ].join("\n"),
    })
  },
)

test("notices and commands speak English by default", async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[], [COMMENT]], argv => (argv.includes(".id, .full_name") ? { stdout: "42\nOwner/Repo\n" } : undefined))

  await $.command.run(CHECK)
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r] someone commented on #3: Looks good"])
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("o/r [r]: Comments on PRs and issues") })
  expect(await $.command.run({ ...CHECK, args: "repo add owner/repo comment,push" })).toEqual({ text: "Registered Owner/Repo (Comments on PRs and issues, Pushes)." })
  expect(await $.command.run({ ...CHECK, args: "nick" })).toEqual({ text: "No nicknames yet. Add one with /inbox nick <login> <nickname>." })
  expect(await $.command.run({ ...CHECK, args: "" })).toMatchObject({
    text: expect.stringContaining(
      '\n\nSettings (change them as "GitHub: …" in /config)\n  Check interval                  60s\n  Where notices show              toast\n',
    ),
  })
})

test("a session that has ended is not marked alive again by a check still under way", JA, async ($, on) => {
  // The store, by hand, to see what is written to it.
  const store = new Map<string, unknown>()
  const written: string[] = []
  on("store.get", async (_$, e) => ({ value: store.get(e.key) }))
  on("store.set", async (_$, e) => {
    written.push(e.key)
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on("store.delete", async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on("store.keys", async () => ({ value: [...store.keys()] }))
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]])
  on("command.register", async (_$, e) => ({ value: { command: e.name } }))
  on("session.id", async () => ({ value: "s1" }))
  on("session.start", async (_$, e) => ({ cwd: e.cwd }))
  on("session.end", async () => ({ sessionId: "s1" }))

  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true })
  expect(written).toContain("presence:s1")
  await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } })
  written.length = 0
  await $.command.run(CHECK)
  expect(written).not.toContain("presence:s1")
})

for (const [language, hint] of [["en", "nick [login [nickname]]"], ["ja", "nick [login [ニックネーム]]"]] as const) {
  test(`/inbox is listed in the command picker in ${language}`, { options: { language } }, async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    fakeGitHub(on, [[]])
    const registered: Array<{ description: string; argumentHint?: string }> = []
    on("command.register", async (_$, e) => {
      registered.push(e)
      return { value: { command: e.name } }
    })

    on("session.id", async () => ({ value: "s1" }))
    on("session.start", async (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.argumentHint).toContain(hint)
    expect(registered[0]?.description.startsWith(language === "en" ? "GitHub notices" : "このブランチの PR")).toBe(true)
  })
}

test("the log pane asks what its page's comments say now, and shows them edited, with what they say now, or deleted", JA, async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const comment = (id: string, body: string) => ({
    id,
    kind: "comment",
    pull: "o/r#3",
    author: "a",
    at,
    text: `aさんがコメントしました。${body}`,
    url: `https://github.com/o/r/pull/3#${id}`,
    items: [{ body, url: `https://github.com/o/r/pull/3#${id}` }],
  })
  mock.store(on, { "history:other": toKept([comment("IC_1", "first"), comment("IC_2", "second"), comment("IC_3", "third")] as GhEvent[], 1) })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  // GitHub answers in the order asked: IC_1 edited, IC_2 deleted, IC_3 edited before it was told, so as it was.
  const now = {
    IC_1: { body: "first, fixed", lastEditedAt: "2026-10-16T23:30:00Z" },
    IC_2: null,
    IC_3: { body: "third", lastEditedAt: "2026-10-16T22:59:00Z" },
  } as Record<string, unknown>
  const answer = (argv: string[]) => {
    const ids = [...(argv.at(-1) ?? "").matchAll(/"(\w+)"/g)].map(match => match[1] ?? "")
    const errors = ids.flatMap((id, index) => (now[id] === null ? [{ type: "NOT_FOUND", path: ["nodes", index] }] : []))
    return { stdout: JSON.stringify({ data: { nodes: ids.map(id => now[id]) }, errors }), exitCode: errors.length > 0 ? 1 : 0 }
  }
  const github = fakeGitHub(on, [[]], argv => (argv.includes("graphql") ? answer(argv) : undefined))
  on("ui.open", async () => ({ value: { isPlaced: true } }))

  await $.command.run({ ...CHECK, args: "log" })
  const pane = await $.ui.mount({
    plugin: "gh-inbox",
    surface: "terminal",
    component: "Pane",
    requestId: "gh-inbox-log",
    props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: "Text", text: "（1時間前、編集済み・30分前）" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "（1時間前、削除済み）" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "（1時間前）" })).toBeDefined()
  // Only the edited one unfolds: the others say all they said.
  expect(await pane.find({ key: "unfold:o/r#3|IC_2" })).toBeUndefined()
  expect(await pane.find({ key: "unfold:o/r#3|IC_3" })).toBeUndefined()
  // One request for the page, not one a render.
  expect(github.asked.filter(argv => argv.includes("graphql"))).toHaveLength(1)

  // The edited comment unfolds to what it says now; the line keeps what was told.
  await pane.press({ key: "unfold:o/r#3|IC_1" })
  expect(await pane.find({ type: "Text", text: "first, fixed" })).toBeDefined()
  expect(github.asked.filter(argv => argv.includes("graphql"))).toHaveLength(1)
})

test("an answer asked for at an earlier opening of the log is not shown over a later one's", JA, async ($, on) => {
  const at = "2026-10-16T23:00:00Z"
  const told = { id: "IC_1", kind: "comment", pull: "o/r#3", author: "a", at, text: "aさんがコメントしました。first", url: "https://github.com/o/r/pull/3#c1", items: [{ body: "first", url: "https://github.com/o/r/pull/3#c1" }] }
  mock.store(on, { "history:other": toKept([told] as GhEvent[], 1) })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  const said = (body: string, editedAt: string) => ({ stdout: JSON.stringify({ data: { nodes: [{ body, lastEditedAt: editedAt }] } }) })
  let release: (answer: Answer) => void = () => undefined
  const pending = new Promise<Answer>(resolve => {
    release = resolve
  })
  let asked = 0
  fakeGitHub(on, [[]], argv => {
    if (!argv.includes("graphql")) return undefined
    asked += 1
    return asked === 1 ? pending : said("newest", "2026-10-16T23:50:00Z")
  })
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  const mount = () =>
    $.ui.mount({
      plugin: "gh-inbox",
      surface: "terminal",
      component: "Pane",
      requestId: "gh-inbox-log",
      props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })

  await $.command.run({ ...CHECK, args: "log" })
  const pane = await mount()
  // Opened again while the first answer is still on its way.
  await $.command.run({ ...CHECK, args: "log" })
  expect(await pane.find({ type: "Text", text: "（1時間前、編集済み・10分前）" })).toBeDefined()

  // The first opening's answer comes last, and is let be.
  release(said("older", "2026-10-16T23:10:00Z"))
  await pending
  expect(await pane.find({ type: "Text", text: "（1時間前、編集済み・10分前）" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "（1時間前、編集済み・50分前）" })).toBeUndefined()
})

type PullSays = {
  number?: number
  title?: string
  state?: "OPEN" | "MERGED" | "CLOSED"
  comments?: Array<{ id: string; author: string; body: string; at: string }>
  head?: string
  /** The newest commit's checks, failed ones by name. */
  failed?: string[]
  /** What GitHub says of merging it now (`mergeStateStatus`). */
  mergeState?: string
  isDraft?: boolean
  /** How it merges once it can, where auto-merge is on. */
  autoMerge?: string
  reviewDecision?: string
  /** Who opened it; alice where not said. */
  author?: string
  /** Whose approval stands, its review's id `PRR_<login>`. */
  approvedBy?: string
  /** How many others approve it, listed first: as many as GitHub is asked for leave `approvedBy`'s out of the list. */
  othersApproving?: number
}

/** `PULL_QUERY`'s answer for o/r#number, as GitHub would give it. */
function pullAnswer(says: PullSays) {
  const number = says.number ?? 12
  const failed = says.failed ?? []
  return JSON.stringify({
    data: {
      viewer: { login: "me" },
      repository: {
        pullRequest: {
          title: says.title ?? "Add things",
          url: `https://github.com/o/r/pull/${number}`,
          state: says.state ?? "OPEN",
          closedAt: says.state === undefined || says.state === "OPEN" ? null : "2026-10-16T01:00:00Z",
          mergeable: "MERGEABLE",
          reviewDecision: says.reviewDecision ?? null,
          isDraft: says.isDraft === true,
          mergeStateStatus: says.mergeState ?? "UNKNOWN",
          autoMergeRequest: says.autoMerge === undefined ? null : { mergeMethod: says.autoMerge },
          author: { login: says.author ?? "alice" },
          mergedBy: says.state === "MERGED" ? { login: "alice" } : null,
          latestOpinionatedReviews: {
            nodes: [
              ...Array.from({ length: says.othersApproving ?? 0 }, (_, index) => ({ state: "APPROVED", author: { login: `r${index}` } })),
              ...(says.approvedBy === undefined ? [] : [{ state: "APPROVED" }]),
            ].slice(0, 50),
          },
          closed: { nodes: [] },
          comments: { nodes: (says.comments ?? []).map(one => ({ id: one.id, author: { login: one.author }, body: one.body, createdAt: one.at, url: `https://github.com/o/r/pull/${number}#${one.id}` })) },
          reviews: { nodes: [] },
          commits: {
            nodes:
              says.head === undefined
                ? []
                : [{ commit: { oid: says.head, messageHeadline: "feat: x", additions: 1, deletions: 0, committedDate: "2026-10-16T00:00:00Z", url: "", author: { name: "me", user: { login: "me" } } } }],
          },
          latest: {
            nodes: [
              {
                commit: {
                  oid: says.head ?? "",
                  statusCheckRollup: {
                    state: failed.length > 0 ? "FAILURE" : "SUCCESS",
                    contexts: {
                      nodes: failed.map((name, index) => ({
                        __typename: "CheckRun",
                        databaseId: 900 + index,
                        name,
                        status: "COMPLETED",
                        conclusion: "FAILURE",
                        detailsUrl: "",
                        steps: { nodes: [] },
                      })),
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  })
}

/** The number a `PULL_QUERY` asks about; undefined for another request. */
const askedPull = (argv: string[]) => (argv.some(word => word.startsWith("query=query($owner") && word.includes("latestOpinionatedReviews")) ? Number(argv.find(word => word.startsWith("number="))?.slice(7)) : undefined)

const SAID = { id: "IC_9", author: "alice", body: "Looks good", at: "2026-10-16T00:30:00Z" }

/** The pane of `/inbox pr`, as the terminal draws it docked. */
const PR_PANE = {
  plugin: "gh-inbox",
  surface: "terminal",
  component: "Pane",
  requestId: "gh-inbox-pr",
  props: { title: "", isFocused: true, bodyColumns: 100, placement: "dock", scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** The row the list of `/inbox pr` shows for `key` (`host/owner/repo#number`), as its label says it; undefined where it shows none. */
async function listedRow($: Engine, key: string) {
  await $.command.run({ ...CHECK, args: "pr" })
  const pane = await $.ui.mount(PR_PANE)
  const row = (await pane.find({ key: `pr:${key}` }))?.props.label
  await pane.unmount()
  return row
}

test("a watched pull request is checked as the branch's is, at every check, its notices named in brackets", JA, async ($, on) => {
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  let says: PullSays = {}
  const github = fakeGitHub(on, [[]], argv => (askedPull(argv) === 12 ? { stdout: pullAnswer(says) } : undefined))

  // The first look takes what is there as seen.
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])

  says = { comments: [SAID] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r#12] aliceさんがコメントしました。Looks good"])
  // One GraphQL request a check, not the Events API.
  expect(github.asked.filter(argv => askedPull(argv) === 12)).toHaveLength(2)
  expect(github.asked.filter(argv => (argv.at(-1) ?? "").includes("/events"))).toHaveLength(0)
  expect(await $.command.run({ ...CHECK, args: "log text" })).toMatchObject({ text: expect.stringContaining("[r#12] aliceさんがコメントしました。Looks good") })
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({ text: expect.stringContaining("通知する PR: 1件（/inbox pr）") })
})

test("a hook on inbox.notify is told a watched pull request's notice as one, named by its repository's alias and number", async ($, on) => {
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } }, repos: { [KEY]: { kinds: [], alias: "tts" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  let says: PullSays = {}
  const github = fakeGitHub(on, [[]], argv => (askedPull(argv) === 12 ? { stdout: pullAnswer(says) } : undefined))
  const told: Array<{ source: string; label: string | null; repo: string; text: string }> = []
  on("inbox.notify", async (_$, e, next) => {
    told.push({ source: e.source, label: e.label, repo: e.repo, text: e.text })
    return next(e)
  })

  await $.command.run(CHECK)
  says = { comments: [SAID] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(told).toEqual([{ source: "watch", label: "tts#12", repo: KEY, text: "[tts#12] alice commented: Looks good" }])
  expect(github.toasts).toEqual(["[tts#12] alice commented: Looks good"])
})

test("what a watched pull request and its registered repository both see is told once, by the pull request", JA, async ($, on) => {
  mock.store(on, { watched: { "github.com/o/r#3": { title: "Add things" } }, repos: { [KEY]: { kinds: ["comment"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { number: 3 }
  // The repository's events tell the same comment, IC_1 on #3.
  const github = fakeGitHub(on, [[], [COMMENT]], argv => (askedPull(argv) === 3 ? { stdout: pullAnswer(says) } : undefined))

  await $.command.run(CHECK)
  says = { number: 3, comments: [{ id: "IC_1", author: "someone", body: "Looks good", at: COMMENT.created_at }] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r#3] someoneさんがコメントしました。Looks good"])
})

test("a failed run of a watched pull request's newest commit is told by the pull request, not its registered repository", JA, async ($, on) => {
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } }, repos: { [KEY]: { kinds: ["ci-failure"], alias: "r" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const run = { id: 39000000009, name: "test", head_branch: "feat", head_sha: "c0ffee", html_url: "", updated_at: "2026-10-16T12:00:00Z", run_attempt: 1, conclusion: "failure" }
  let runs: unknown[] = []
  let says: PullSays = { head: "c0ffee" }
  const github = fakeGitHub(on, [[]], argv => {
    if (askedPull(argv) === 12) return { stdout: pullAnswer(says) }
    const path = argv.find(word => word.includes("/actions/runs")) ?? ""
    if (path.endsWith("/jobs")) return { stdout: JSON.stringify({ jobs: [] }) }
    if (path !== "") return { stdout: `HTTP/2.0 200 OK\nEtag: "r${runs.length}"\n\n${JSON.stringify({ workflow_runs: runs })}` }
    return undefined
  })

  await $.command.run(CHECK)
  runs = [run]
  says = { head: "c0ffee", failed: ["test"] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r#12] testのCIが失敗しました。"])
})

test("a watched pull request seen merged is told once, then not asked about, and leaves the list a day later", JA, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  let says: PullSays = {}
  const github = fakeGitHub(on, [[]], argv => (askedPull(argv) === 12 ? { stdout: pullAnswer(says) } : undefined))
  const asked = () => github.asked.filter(argv => askedPull(argv) === 12).length

  await $.command.run(CHECK)
  says = { state: "MERGED" }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r#12] #12 がマージされました。"])
  expect(await listedRow($, "github.com/o/r#12")).toBe("r#12（マージ済み）  Add things")

  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(asked()).toBe(2)
  expect(github.toasts).toHaveLength(1)

  await clock.advance(24 * 3600_000)
  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "status" })).not.toMatchObject({ text: expect.stringContaining("通知する PR:") })
  // Its merge is still among the notices the log keeps.
  expect(await listedRow($, "github.com/o/r#12")).toStartWith("r#12  通知1件")
})

test("the branch's own pull request, watched too, is asked about once a check, as the branch's", JA, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } } })
  mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  const github = fakeGitHub(on, [[]], branchPull(COMMENT.created_at))

  await $.command.run(CHECK)
  expect(github.asked.filter(argv => argv.includes("graphql") && !isMineSearch(argv))).toHaveLength(1)
  // Listed once, as the branch's.
  await $.command.run({ ...CHECK, args: "pr" })
  const pane = await $.ui.mount(PR_PANE)
  expect((await pane.find({ key: "pr:github.com/o/r#12" }))?.props.label).toBe("r#12  ✗ コンフリクト  ✗ CI 1/2  ✓ 承認2  Add things")
  expect(await pane.find({ type: "Text", text: "今のブランチ" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "通知している PR" })).toBeUndefined()
  // Shown, it says where it stands with the reviewers named, who wrote last, and that it is watched as the branch's.
  await pane.press({ key: "pr:github.com/o/r#12" })
  const stands = { type: "Text", text: "  ✗ コンフリクト  ✗ CI 1/2  ✓ 承認（bobさん、carolさん） | aliceさん「Looks good」5分前" } as const
  for (let tries = 0; tries < 100 && (await pane.find({ key: "pr:merge" })) === undefined; tries += 1) await pane.find({ key: "close" })
  expect((await pane.findAll({ type: "Text" })).map(one => one.text)).toContainEqual(expect.stringContaining(stands.text))
  expect(await pane.find({ type: "Text", text: "通知中、今のブランチの PR" })).toBeDefined()
})

test("/inbox pr watch takes a pull request as GitHub spells it and refuses one watched or merged; unwatch stops it", JA, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]], argv => {
    if (argv.includes("repo") && argv.includes("view")) return { stdout: "https://github.com/o/r\n" }
    const number = askedPull(argv)
    if (number === 404) return { exitCode: 1, stderr: "gh: Could not resolve to a PullRequest with the number of 404." }
    return number === undefined ? undefined : { stdout: pullAnswer({ number, state: number === 13 ? "MERGED" : "OPEN" }) }
  })
  const run = (args: string) => $.command.run({ ...CHECK, args })

  expect(await run("pr O/R#12 watch")).toEqual({ text: "o/r#12 Add things の通知を始めます。今のブランチの PR と同じように通知します。" })
  expect(await run("pr watch 12")).toEqual({ text: "o/r#12 はもう通知しています。" })
  expect(await run("pr https://github.com/o/r/pull/12 watch")).toEqual({ text: "o/r#12 はもう通知しています。" })
  expect(await run("pr o/r#13 watch")).toEqual({ text: "o/r#13 はマージ済みです。これ以上通知するものはありません。" })
  expect(await run("pr o/r#404 watch")).toEqual({ text: "o/r#404 を読めませんでした: gh: Could not resolve to a PullRequest with the number of 404." })
  expect(await run("pr nonsense watch")).toEqual({ text: "PR は 12・owner/repo#12・PR の URL のどれかで指定します。" })
  expect(await listedRow($, "github.com/o/r#12")).toBe("r#12  Add things")
  expect(github.toasts).toEqual([])

  expect(await run("pr o/r#13 unwatch")).toEqual({ text: "o/r#13 は通知していません。" })
  expect(await run("pr 12 unwatch")).toEqual({ text: "o/r#12 の通知をやめました。" })
  expect(await listedRow($, "github.com/o/r#12")).toBeUndefined()
  expect(await run("pr 12 other")).toMatchObject({ text: expect.stringMatching(/^使い方:/) })
})

test("the branch's own pull request, watched too, is marked merged as the branch's check sees it, and leaves the list a day later", JA, async ($, on) => {
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  mock.store(on, { watched: { "github.com/o/r#12": { title: "Add things" } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  let state: "OPEN" | "MERGED" = "OPEN"
  const github = fakeGitHub(on, [[]], argv => {
    if (argv[0] === "git") return { stdout: "feat\n" }
    if (argv.includes("pr") && argv.includes("view")) return { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/12", state }) }
    return askedPull(argv) === 12 ? { stdout: pullAnswer({ state }) } : undefined
  })

  await $.command.run(CHECK)
  state = "MERGED"
  await clock.advance(61_000)
  await $.command.run(CHECK)
  // Told as the branch's, not again as a watched one's.
  expect(github.toasts).toEqual(["GitHub: #12 の通知を始めます。Add things", "#12 がマージされました。"])
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({ text: expect.stringContaining("通知する PR: 1件") })
  expect(await listedRow($, "github.com/o/r#12")).toBe("r#12（マージ済み）  Add things")

  // The window stays on the branch.
  await clock.advance(24 * 3600_000 + 61_000)
  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "status" })).not.toMatchObject({ text: expect.stringContaining("通知する PR:") })
})

test("a pull request added again, in this window or another, starts over: what came while it was not watched is no news", JA, async ($, on) => {
  // The store, by hand, to change it as another window would.
  const store = new Map<string, unknown>([["watched", { "github.com/o/r#12": { title: "Add things", since: 1 } }]])
  on("store.get", async (_$, e) => ({ value: store.get(e.key) }))
  on("store.set", async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on("store.delete", async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on("store.keys", async () => ({ value: [...store.keys()] }))
  const clock = mock.clock(on, { now: 1_000_000 })
  let says: PullSays = {}
  const github = fakeGitHub(on, [[]], argv => (askedPull(argv) === 12 ? { stdout: pullAnswer(says) } : undefined))
  const later = { id: "IC_10", author: "bob", body: "And this", at: "2026-10-16T00:40:00Z" }

  await $.command.run(CHECK)
  // Another window removes it, a comment comes, and it is added again there: the list says when.
  says = { comments: [SAID] }
  store.set("watched", { "github.com/o/r#12": { title: "Add things", since: 2 } })
  store.delete("shared-seen:github.com/o/r#12")
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual([])

  says = { comments: [SAID, later] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts).toEqual(["[r#12] bobさんがコメントしました。And this"])
})

test("the branch's own pull request, watched, goes on as a watched one once the branch is switched away from: what comes is told one by one", JA, async ($, on) => {
  mock.store(on, {})
  const clock = mock.clock(on, { now: 1_000_000 })
  let branch = "feat"
  let says: PullSays = {}
  const github = fakeGitHub(on, [[]], argv => {
    if (argv[0] === "git") return { stdout: `${branch}\n` }
    if (argv.includes("pr") && argv.includes("view"))
      return branch === "feat" ? { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/12", state: "OPEN" }) } : { exitCode: 1, stderr: 'no pull requests found for branch "main"' }
    return askedPull(argv) === 12 ? { stdout: pullAnswer(says) } : undefined
  })

  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "pr o/r#12 watch" })).toMatchObject({ text: expect.stringContaining("の通知を始めます") })
  await clock.advance(61_000)
  await $.command.run(CHECK)

  branch = "main"
  says = { comments: [SAID] }
  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(github.toasts.at(-1)).toBe("[r#12] aliceさんがコメントしました。Looks good")
})

const HEAD = "abc1234def5678abc1234def5678abc1234def56"
/** The merge settings GitHub answers for o/r: squash and merge commits allowed, squash the one used last. */
const SETTINGS = JSON.stringify({
  data: { repository: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: true, viewerDefaultMergeMethod: "SQUASH" } },
})
/** What o/r#12 holds to hand to Claude, as `/inbox pr 12` asks for it: nothing yet. */
const PICKED = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        id: "PR_12",
        title: "Add things",
        url: "https://github.com/o/r/pull/12",
        headRefOid: HEAD,
        body: "",
        author: { login: "alice" },
        reviewThreads: { nodes: [] },
        reviews: { nodes: [] },
        comments: { nodes: [] },
        head: { nodes: [] },
      },
    },
  },
})
const ACT_PANE = { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

/** `gh` and `git` for a branch whose pull request is o/r#12, as `says` tells it; `acted` answers what changes it. */
function actingGitHub(on: On, says: () => PullSays, acted: (argv: string[]) => Answer = () => ({ stdout: "" })) {
  const opened: string[] = []
  on("ui.open", async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on("ui.close", async () => ({ value: undefined }))
  const github = fakeGitHub(on, [[]], argv => {
    if (argv[0] === "git") return { stdout: "feat\n" }
    if (argv[1] === "repo" && argv[2] === "view") return { stdout: "https://github.com/o/r\n" }
    if (argv[1] === "pr" && argv[2] === "view") return { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/12", state: "OPEN" }) }
    if (argv[1] === "pr" || isReviewSent(argv)) return acted(argv)
    if (askedPull(argv) === 12) return { stdout: pullAnswer({ head: HEAD, ...says() }) }
    if (argv.some(word => word.includes("reviewThreads"))) return { stdout: PICKED }
    if (argv.some(word => word.includes("squashMergeAllowed"))) return { stdout: SETTINGS }
    // The person's own last review that says yes or no: their approval where `approvedBy` is them.
    if (argv.some(word => word.includes("reviews(author: $login"))) {
      const by = says().approvedBy
      const nodes = by !== undefined && argv.includes(`login=${by}`) ? [{ id: `PRR_${by}`, state: "APPROVED" }] : []
      return { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes } } } } }) }
    }
    return undefined
  })
  return { ...github, opened }
}

/** Whether `argv` approves a pull request or withdraws an approval. */
const isReviewSent = (argv: string[]) => argv.includes("event=APPROVE") || argv.some(word => word.includes("dismissPullRequestReview"))
/** What was sent to change a pull request: `gh pr merge`, `close`, `ready`, an approval or its withdrawal. */
const changes = (asked: string[][]) => asked.filter(argv => (argv[1] === "pr" && argv[2] !== "view") || isReviewSent(argv))

test("/inbox pr merge asks in a pane, and merges at the head commit it showed only once its button is pressed", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let isMerged = false
  const github = actingGitHub(
    on,
    () => (isMerged ? { state: "MERGED" } : { mergeState: "CLEAN" }),
    () => {
      isMerged = true
      return { stdout: "" }
    },
  )

  expect(await $.command.run({ ...CHECK, args: "pr merge" })).toEqual({ text: "ペインで確かめてください。ボタンを押すまでは何もしません。" })
  expect(changes(github.asked)).toEqual([])
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  expect(await pane.find({ type: "Text", text: "abc1234  ● マージ可" })).toBeDefined()
  // The method the person used last is offered first; another can be chosen.
  expect((await pane.find({ key: "act" }))?.props.label).toBe("スカッシュでマージする")
  await pane.press({ key: "method:MERGE" })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("マージコミットでマージする")
  // Sent by the button alone: it has no hotkey.
  expect((await pane.find({ key: "act" }))?.props.hotkey).toBeUndefined()

  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && !github.toasts.includes("o/r#12 をマージしました。"); tries += 1) await pane.find({ key: "act" })
  expect(changes(github.asked)).toEqual([["gh", "pr", "merge", "https://github.com/o/r/pull/12", "--merge", "--match-head-commit", HEAD]])
  expect(github.toasts).toContain("o/r#12 をマージしました。")
})

test("/inbox pr merge refuses what cannot be merged now, before any pane", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { isDraft: true, mergeState: "DRAFT" }
  const github = actingGitHub(on, () => says)

  expect(await $.command.run({ ...CHECK, args: "pr merge" })).toEqual({ text: "o/r#12: 下書きです。先にレビュー待ちにします（/inbox pr o/r#12 draft）。" })
  says = { mergeState: "BEHIND" }
  expect(await $.command.run({ ...CHECK, args: "pr merge o/r#12" })).toMatchObject({ text: expect.stringContaining("base が先に進んでいて") })
  says = { mergeState: "CLEAN" }
  expect(await $.command.run({ ...CHECK, args: "pr merge rebase" })).toEqual({ text: "このリポジトリではリベースは使えません。使えるもの: マージコミット、スカッシュ" })
  says = { state: "MERGED" }
  expect(await $.command.run({ ...CHECK, args: "pr merge" })).toEqual({ text: "o/r#12 はもうマージ済みです。" })
  expect(github.opened).toEqual([])
  expect(changes(github.asked)).toEqual([])
})

test("a merge a merge queue only took in is not said to be merged", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  // `gh pr merge` succeeds, the pull request still open: in the queue.
  const github = actingGitHub(on, () => ({ mergeState: "CLEAN" }))

  await $.command.run({ ...CHECK, args: "pr merge o/r#12" })
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  await pane.press({ key: "act" })
  const queued = "o/r#12 を GitHub が受け付けましたが、まだマージされていません。マージキューを通るとマージされます。"
  for (let tries = 0; tries < 100 && !github.toasts.includes(queued); tries += 1) await pane.find({ key: "act" })
  expect(github.toasts).toContain(queued)
  expect(github.toasts.filter(text => text.includes("マージしました"))).toEqual([])
})

test("a merge GitHub refuses says why in the pane, which stays to try again or close", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  const github = actingGitHub(on, () => ({ mergeState: "CLEAN" }), () => ({ exitCode: 1, stderr: "X Head branch was modified. Review and try the merge again.\n" }))

  await $.command.run({ ...CHECK, args: "pr merge" })
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  await pane.press({ key: "act" })
  const refused = { type: "Text", text: "GitHub に断られました: X Head branch was modified. Review and try the merge again." } as const
  for (let tries = 0; tries < 100 && (await pane.find(refused)) === undefined; tries += 1) await pane.find({ key: "act" })
  expect(await pane.find(refused)).toBeDefined()
  expect((await pane.find({ key: "cancel" }))?.props.label).toBe("閉じる")
  expect(changes(github.asked)).toHaveLength(1)
  expect(github.toasts.filter(text => text.includes("マージしました"))).toEqual([])
})

test("/inbox pr close and draft ask in the pane too, and cancelling sends nothing", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { isDraft: true, mergeState: "DRAFT" }
  const github = actingGitHub(on, () => says)

  // A draft is marked ready for review.
  await $.command.run({ ...CHECK, args: "pr draft" })
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("レビュー待ちにする")
  await pane.press({ key: "cancel" })
  expect(changes(github.asked)).toEqual([])

  // One ready for review goes back to a draft.
  // `/inbox` says it is a draft beside what it is watched as.
  await $.command.run(CHECK)
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({ text: expect.stringContaining("o/r#12 Add things（下書き）\n") })

  says = { mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }
  await $.command.run({ ...CHECK, args: "pr draft 12" })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("下書きに戻す")
  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && changes(github.asked).length === 0; tries += 1) await pane.find({ key: "act" })
  expect(changes(github.asked)).toEqual([["gh", "pr", "ready", "https://github.com/o/r/pull/12", "--undo"]])

  await $.command.run({ ...CHECK, args: "pr close" })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("マージせずにクローズする")
  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && changes(github.asked).length < 2; tries += 1) await pane.find({ key: "act" })
  expect(changes(github.asked).at(-1)).toEqual(["gh", "pr", "close", "https://github.com/o/r/pull/12"])
})

test("one a required review keeps from merging turns on auto-merge, and one with it on turns it off", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }
  const github = actingGitHub(on, () => says)

  await $.command.run({ ...CHECK, args: "pr merge" })
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  expect(await pane.find({ type: "Text", text: "It cannot be merged yet (○ awaiting review): auto-merge merges it once it can." })).toBeDefined()
  expect((await pane.find({ key: "act" }))?.props.label).toBe("Turn on auto-merge (squash)")
  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && changes(github.asked).length === 0; tries += 1) await pane.find({ key: "act" })
  expect(changes(github.asked)).toEqual([["gh", "pr", "merge", "https://github.com/o/r/pull/12", "--squash", "--match-head-commit", HEAD, "--auto"]])

  says = { mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", autoMerge: "SQUASH" }
  await $.command.run({ ...CHECK, args: "pr merge" })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("Turn off auto-merge")
  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && changes(github.asked).length < 2; tries += 1) await pane.find({ key: "act" })
  expect(changes(github.asked).at(-1)).toEqual(["gh", "pr", "merge", "https://github.com/o/r/pull/12", "--disable-auto"])
})

test("/inbox pr approve approves the head commit the pane showed once its button is pressed; unapprove withdraws it by a dismissal", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let approvedBy: string | undefined
  const github = actingGitHub(on, () => ({ mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", approvedBy }))

  expect(await $.command.run({ ...CHECK, args: "pr approve" })).toEqual({ text: "ペインで確かめてください。ボタンを押すまでは何もしません。" })
  expect(github.opened).toEqual(["gh-inbox-act"])
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  expect(await pane.find({ type: "Text", text: "abc1234  ○ レビュー待ち" })).toBeDefined()
  expect((await pane.find({ key: "act" }))?.props.label).toBe("承認する")
  expect((await pane.find({ key: "act" }))?.props.hotkey).toBeUndefined()
  expect(changes(github.asked)).toEqual([])

  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && !github.toasts.includes("o/r#12 を承認しました。"); tries += 1) await pane.find({ key: "cancel" })
  expect(changes(github.asked)).toEqual([["gh", "api", "--silent", "-X", "POST", "repos/o/r/pulls/12/reviews", "-f", `commit_id=${HEAD}`, "-f", "event=APPROVE"]])
  expect(github.toasts).toContain("o/r#12 を承認しました。")

  // Approved already: not again, and the way to withdraw it said.
  approvedBy = "me"
  expect(await $.command.run({ ...CHECK, args: "pr approve" })).toEqual({ text: "o/r#12: もう承認しています。取り消すには /inbox pr o/r#12 unapprove を使います。" })

  await $.command.run({ ...CHECK, args: "pr unapprove 12" })
  expect(await pane.find({ type: "Text", text: "GitHub では、自分のレビューの却下（dismiss）として「承認を取り消しました」と PR に残ります。" })).toBeDefined()
  expect((await pane.find({ key: "act" }))?.props.label).toBe("承認を取り消す")
  await pane.press({ key: "act" })
  for (let tries = 0; tries < 100 && !github.toasts.includes("o/r#12 の承認を取り消しました。"); tries += 1) await pane.find({ key: "cancel" })
  const dismissal = changes(github.asked).at(-1) ?? []
  expect(dismissal.slice(0, 4)).toEqual(["gh", "api", "graphql", "--silent"])
  expect(dismissal.slice(-4)).toEqual(["-f", "id=PRR_me", "-f", "message=承認を取り消しました"])
  expect(github.toasts).toContain("o/r#12 の承認を取り消しました。")

  approvedBy = undefined
  expect(await $.command.run({ ...CHECK, args: "pr unapprove" })).toEqual({ text: "o/r#12: この PR は承認していません。" })
  expect(changes(github.asked)).toHaveLength(2)
})

test("/inbox pr approve refuses one's own pull request before any pane, and says in the pane why GitHub refused one", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let author = "me"
  const github = actingGitHub(
    on,
    () => ({ mergeState: "BLOCKED", author }),
    () => ({ exitCode: 1, stderr: "gh: Can not approve a draft pull request (HTTP 422)\n" }),
  )

  expect(await $.command.run({ ...CHECK, args: "pr approve" })).toEqual({ text: "o/r#12: It is your own pull request: GitHub does not let its author approve it." })
  expect(github.opened).toEqual([])

  author = "alice"
  await $.command.run({ ...CHECK, args: "pr approve" })
  const pane = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "Pane", requestId: "gh-inbox-act", props: ACT_PANE })
  expect((await pane.find({ key: "act" }))?.props.label).toBe("Approve")
  await pane.press({ key: "act" })
  const refused = { type: "Text", text: "GitHub refused it: gh: Can not approve a draft pull request (HTTP 422)" } as const
  for (let tries = 0; tries < 100 && (await pane.find(refused)) === undefined; tries += 1) await pane.find({ key: "cancel" })
  expect(await pane.find(refused)).toBeDefined()
  expect(github.toasts.filter(text => text.startsWith("Approved"))).toEqual([])
})

test("/inbox pr lists pull requests a group each, every one once, those the log keeps notices of with where they stand as GitHub says", JA, async ($, on) => {
  const at = (minutes: number) => new Date(Date.parse("2026-10-16T23:00:00Z") + minutes * 60_000).toISOString()
  const comment = (id: string, number: number, minutes: number, page = "pull") => ({
    id,
    kind: "comment",
    pull: `o/r#${number}`,
    author: "a",
    who: "aさん",
    head: `aさんが #${number} にコメントしました。`,
    label: "rr",
    at: at(minutes),
    text: `[rr] aさんが #${number} にコメントしました。${id}`,
    url: `https://github.com/o/r/${page}/${number}#issuecomment-${id}`,
    items: [],
  })
  const push = {
    id: "event:1",
    kind: "push",
    pull: "o/r",
    author: "a",
    who: "aさん",
    head: "aさんが main に push しました。",
    label: "rr",
    at: at(20),
    text: "[rr] aさんが main に push しました。fix",
    url: "https://github.com/o/r/compare/a...b",
    items: [],
  }
  mock.store(on, {
    "history:other": toKept([comment("c1", 3, 0), comment("c2", 5, 10), push, comment("c3", 3, 30), comment("i1", 7, 40, "issues")] as GhEvent[], 1),
    repos: { "github.com/o/r": { kinds: ["comment", "push"], alias: "rr" } },
    // The title of #5 is kept for the repository's notices: it shows before GitHub answers.
    "titles:github.com/o/r": { "5": { title: "Known title", author: null } },
    watched: { "github.com/x/y#9": { title: "Elsewhere" } },
  })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  const headings = {
    n3: {
      __typename: "PullRequest",
      title: "Add things",
      state: "OPEN",
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "bob" } }] },
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "carol" } }] },
      latest: { nodes: [] },
    },
    n5: { __typename: "PullRequest", title: "Known title", state: "MERGED" },
    n11: { __typename: "PullRequest", title: "Found here", state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
  }
  const found = {
    issueCount: 2,
    nodes: [
      { number: 3, title: "Add things", url: "https://github.com/o/r/pull/3", updatedAt: "2026-10-16T00:00:00Z", author: { login: "a" } },
      { number: 11, title: "Found here", url: "https://github.com/o/r/pull/11", updatedAt: "2026-10-15T00:00:00Z", author: { login: "alice" } },
    ],
  }
  const github = fakeGitHub(on, [[]], argv => {
    if (argv.includes("repo") && argv.includes("view")) return { stdout: "https://github.com/o/r\n" }
    if (argv.some(word => word.includes("issueOrPullRequest"))) return { stdout: JSON.stringify({ data: { repository: headings } }) }
    if (argv.some(word => word.includes("here: search("))) return { stdout: JSON.stringify({ data: { here: found } }) }
    const number = askedPull(argv)
    return number === undefined ? undefined : { stdout: pullAnswer({ number, title: "Add things" }) }
  })

  expect(await $.command.run({ ...CHECK, args: "pr" })).toEqual({ text: "PR の一覧をペインで開きました。押すとその PR を開きます。" })
  const pane = await $.ui.mount(PR_PANE)
  const row = async (key: string) => (await pane.find({ key: `pr:${key}` }))?.props
  for (let tries = 0; tries < 100 && !String((await row("github.com/o/r#3"))?.label).includes("レビュー待ち"); tries += 1) await pane.find({ key: "close" })
  expect((await row("github.com/x/y#9"))?.label).toBe("y#9  Elsewhere")
  expect((await row("github.com/o/r#3"))?.label).toBe("rr#3  ○ レビュー待ち  ✓ 承認1  Add things  通知2件・30分前")
  expect((await row("github.com/o/r#5"))?.label).toBe("rr#5（マージ済み）  Known title  通知1件・50分前")
  expect((await row("github.com/o/r#11"))?.label).toBe("rr#11  aliceさん  ● マージ可  Found here")
  // The first nine are pressed by their digits too, in the order shown.
  expect(await Promise.all(["github.com/x/y#9", "github.com/o/r#3", "github.com/o/r#5", "github.com/o/r#11"].map(async key => (await row(key))?.hotkey))).toEqual(["1", "2", "3", "4"])
  // An issue's notices, and a push's, are no pull request's.
  expect(await row("github.com/o/r#7")).toBeUndefined()
  const texts = (await pane.findAll({ type: "Text" })).map(one => one.text)
  expect(texts.filter(text => text.endsWith("PR"))).toEqual(["通知している PR", "ログに残っている PR", "このリポジトリと登録したリポジトリの PR"])
  // One request for those that say nothing of where they stand: the watched one's is the check's.
  const asked = github.asked.filter(argv => argv.some(word => word.includes("issueOrPullRequest")))
  expect(asked).toHaveLength(1)
  expect(asked[0]?.find(word => word.startsWith("query="))).toMatch(/n3:[\s\S]*n5:[\s\S]*n11:/)

  // One pressed shows; the list comes back as it was.
  await pane.press({ key: "pr:github.com/o/r#3" })
  for (let tries = 0; tries < 100 && (await pane.find({ type: "Link" })) === undefined; tries += 1) await pane.find({ key: "close" })
  expect((await pane.find({ type: "Link" }))?.props.href).toBe("https://github.com/o/r/pull/3")
  await pane.press({ key: "list" })
  expect((await row("github.com/o/r#3"))?.label).toBe("rr#3  ○ レビュー待ち  ✓ 承認1  Add things  通知2件・30分前")

  // In a narrow pane a row keeps to one line: its title gives way, where it stands and its notices kept; its label, all.
  await pane.unmount()
  const narrow = await $.ui.mount({ ...PR_PANE, props: { ...PR_PANE.props, bodyColumns: 60 } })
  expect((await narrow.findAll({ type: "Text" })).map(one => one.text)).toContain("  Add th…  通知2件・30分前")
  expect((await narrow.find({ key: "pr:github.com/o/r#3" }))?.props.label).toBe("rr#3  ○ レビュー待ち  ✓ 承認1  Add things  通知2件・30分前")
})

test("/inbox pr asks where more of one repository's pull requests stand than one request holds in as many requests, each once", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  const found = Array.from({ length: 55 }, (_, index) => ({
    number: index + 1,
    title: `Pull ${index + 1}`,
    url: `https://github.com/o/r/pull/${index + 1}`,
    updatedAt: "2026-10-15T00:00:00Z",
    author: { login: "alice" },
  }))
  const github = fakeGitHub(on, [[]], argv => {
    if (argv.includes("repo") && argv.includes("view")) return { stdout: "https://github.com/o/r\n" }
    const query = argv.find(word => word.startsWith("query=")) ?? ""
    if (query.includes("here: search(")) return { stdout: JSON.stringify({ data: { here: { issueCount: found.length, nodes: found } } }) }
    if (!query.includes("issueOrPullRequest")) return undefined
    const asked = [...query.matchAll(/n(\d+): issueOrPullRequest/g)].map(match => Number(match[1]))
    const heading = (number: number) => ({ __typename: "PullRequest", title: `Pull ${number}`, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" })
    return { stdout: JSON.stringify({ data: { repository: Object.fromEntries(asked.map(number => [`n${number}`, heading(number)])) } }) }
  })

  await $.command.run({ ...CHECK, args: "pr" })
  const pane = await $.ui.mount(PR_PANE)
  const label = async (number: number) => (await pane.find({ key: `pr:github.com/o/r#${number}` }))?.props.label
  for (let tries = 0; tries < 100 && !String(await label(55)).includes("マージ可"); tries += 1) await pane.find({ key: "close" })
  expect(await label(1)).toBe("r#1  aliceさん  ● マージ可  Pull 1")
  expect(await label(55)).toBe("r#55  aliceさん  ● マージ可  Pull 55")
  expect(github.asked.filter(argv => argv.some(word => word.includes("issueOrPullRequest")))).toHaveLength(2)
})

test("the pane of /inbox pr <PR> says where it stands and what can be done to it, and why what was pressed cannot be", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }
  const github = actingGitHub(on, () => says)

  expect(await $.command.run({ ...CHECK, args: "pr 12" })).toEqual({ text: "ペインで開きました。Claude に渡すものを選んで「添付する」を押すか、操作のボタンを押します。" })
  expect(github.opened).toEqual(["gh-inbox-pr"])
  const pane = await $.ui.mount(PR_PANE)
  const label = async (key: string) => (await pane.find({ key }))?.props.label
  // Named as the list names it, its repository in full under it.
  expect((await pane.find({ type: "Link" }))?.props.href).toBe("https://github.com/o/r/pull/12")
  // (A Link's text as found leads with its address.)
  expect((await pane.find({ type: "Link" }))?.text).toBe("https://github.com/o/r/pull/12r#12")
  expect(await pane.find({ type: "Text", text: "o/r、aliceさんの PR" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "abc1234  ○ レビュー待ち" })).toBeDefined()
  expect(await label("pr:watch")).toBe("通知する")
  expect(await label("pr:merge")).toBe("マージする")
  expect(await label("pr:draft")).toBe("下書きに戻す")
  expect(await label("pr:approve")).toBe("承認する")
  expect(await label("pr:close")).toBe("クローズする")
  expect(await pane.find({ type: "Text", text: "レビュー・コメントはありません。" })).toBeDefined()

  // Watching is saved at once; a merge opens the pane that confirms it, nothing sent before its button.
  await pane.press({ key: "pr:watch" })
  expect(await label("pr:watch")).toBe("通知をやめる")
  expect(await pane.find({ type: "Text", text: "o/r、aliceさんの PR、通知中" })).toBeDefined()
  await pane.press({ key: "pr:merge" })
  for (let tries = 0; tries < 100 && !github.opened.includes("gh-inbox-act"); tries += 1) await pane.find({ key: "close" })
  expect(github.opened).toEqual(["gh-inbox-pr", "gh-inbox-act"])
  expect(changes(github.asked)).toEqual([])

  // Read again: one's own draft has no button to approve it or to merge it, marking it ready a button of its own; the
  // head commit alone, with nothing of where it stands, is no line.
  says = { isDraft: true, mergeState: "DRAFT", author: "me" }
  await pane.press({ key: "reload" })
  for (let tries = 0; tries < 100 && (await label("pr:draft")) !== "レビュー待ちにする"; tries += 1) await pane.find({ key: "close" })
  expect(await pane.find({ key: "pr:approve" })).toBeUndefined()
  expect(await pane.find({ key: "pr:merge" })).toBeUndefined()
  expect((await pane.findAll({ type: "Text" })).map(one => one.text)).not.toContain("abc1234")

  // Made a draft again before the pane knew: why it cannot be merged is said on the pane, with no command for what its
  // own button does, and it is read again, so the buttons follow.
  says = { mergeState: "CLEAN", author: "me" }
  await pane.press({ key: "reload" })
  for (let tries = 0; tries < 100 && (await label("pr:merge")) !== "マージする"; tries += 1) await pane.find({ key: "close" })
  says = { isDraft: true, mergeState: "DRAFT", author: "me" }
  await pane.press({ key: "pr:merge" })
  const refused = { type: "Text", text: "o/r#12: 下書きです。先にレビュー待ちにします。" } as const
  for (let tries = 0; tries < 100 && (await pane.find(refused)) === undefined; tries += 1) await pane.find({ key: "close" })
  expect(await pane.find(refused)).toBeDefined()
  expect(await label("pr:draft")).toBe("レビュー待ちにする")
  expect(await pane.find({ key: "pr:merge" })).toBeUndefined()
  expect(await pane.find({ type: "Text", text: "GitHub に確かめています…" })).toBeUndefined()
  expect(github.opened).toEqual(["gh-inbox-pr", "gh-inbox-act"])

  // Back on the list, it is there, watched and the branch's.
  await pane.press({ key: "list" })
  for (let tries = 0; tries < 100 && (await pane.find({ key: "pr:github.com/o/r#12" })) === undefined; tries += 1) await pane.find({ key: "close" })
  expect(await pane.find({ key: "pr:github.com/o/r#12" })).toBeDefined()
})

test("the pane of /inbox pr <PR> asks whether the person approves it where as many reviewers came as are asked for, theirs maybe left out", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  let says: PullSays = { mergeState: "BLOCKED", othersApproving: 50, approvedBy: "me" }
  const github = actingGitHub(on, () => says)
  const asked = () => github.asked.filter(argv => argv.some(word => word.includes("reviews(author: $login"))).length

  await $.command.run({ ...CHECK, args: "pr 12" })
  const pane = await $.ui.mount(PR_PANE)
  const label = async () => (await pane.find({ key: "pr:approve" }))?.props.label
  expect(await label()).toBe("承認を取り消す")
  expect(asked()).toBe(1)

  // With fewer, whether the person approves it is read from those that came: not asked.
  says = { mergeState: "BLOCKED", othersApproving: 3 }
  await pane.press({ key: "reload" })
  for (let tries = 0; tries < 100 && (await label()) !== "承認する"; tries += 1) await pane.find({ key: "close" })
  expect(await label()).toBe("承認する")
  expect(asked()).toBe(1)
})

test("a pull request still asked for as /inbox pr opens the list is not shown over the list", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  let answer: () => void = () => undefined
  const answered = new Promise<void>(resolve => {
    answer = resolve
  })
  const github = fakeGitHub(on, [[]], async argv => {
    if (argv[1] === "repo" && argv[2] === "view") return { stdout: "https://github.com/o/r\n" }
    if (askedPull(argv) !== 12) return undefined
    await answered
    return { stdout: pullAnswer({}) }
  })

  const pane = await $.ui.mount(PR_PANE)
  const shown = $.command.run({ ...CHECK, args: "pr 12" })
  for (let tries = 0; tries < 100 && !github.asked.some(argv => askedPull(argv) === 12); tries += 1) await pane.find({ key: "close" })
  expect(await $.command.run({ ...CHECK, args: "pr" })).toEqual({ text: "PR の一覧をペインで開きました。押すとその PR を開きます。" })
  answer()
  await shown
  expect(await pane.find({ type: "Link" })).toBeUndefined()
  expect(await pane.find({ key: "list" })).toBeUndefined()
})

test("each pull request's command that went under /inbox pr says where it went", JA, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]])

  expect(await $.command.run({ ...CHECK, args: "merge 12 squash" })).toEqual({
    text: "/inbox merge は /inbox pr にまとめました。今のブランチの PR は /inbox pr merge、ほかの PR は /inbox pr 12 merge です。",
  })
  expect(await $.command.run({ ...CHECK, args: "watch add 12" })).toEqual({
    text: "/inbox watch は /inbox pr にまとめました。/inbox pr 12 watch で通知を始め（やめるときは unwatch）、通知している PR は /inbox pr の一覧に出ます。",
  })
  expect(await $.command.run({ ...CHECK, args: "pr 12 13" })).toMatchObject({ text: expect.stringMatching(/^使い方:\n {2}\/inbox pr /) })
})

test("/inbox pr speaks English by default", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  const github = actingGitHub(on, () => ({ mergeState: "CLEAN" }))

  expect(await $.command.run({ ...CHECK, args: "pick" })).toEqual({ text: "/inbox pick is now part of /inbox pr: /inbox pr show for this branch's pull request, /inbox pr 12 for another." })
  expect(await $.command.run({ ...CHECK, args: "pr pick" })).toEqual({ text: 'Showed it in the pane: choose what to hand to Claude and press "Attach", or press what to do to it.' })
  const pane = await $.ui.mount(PR_PANE)
  expect(await pane.find({ type: "Text", text: "opened by alice" })).toBeDefined()
  expect(await pane.find({ type: "Text", text: "abc1234  ● ready to merge" })).toBeDefined()
  expect((await pane.find({ key: "pr:merge" }))?.props.label).toBe("Merge")
  expect((await pane.find({ key: "stage" }))?.props.label).toBe("Attach (0)")
  expect(github.opened).toEqual(["gh-inbox-pr"])
})

// The band above the prompt, unfolded, as the terminal draws it.
const BAND = {
  plugin: "gh-inbox",
  surface: "terminal",
  component: "AbovePrompt",
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** A pull request the search for the person's own finds, as `MINE_QUERY` asks for it: open, blocked, with no checks or reviews unless `more` says. */
const minePull = (url: string, title: string, updatedAt: string, more: Record<string, unknown> = {}) => ({
  number: Number(url.split("/").at(-1)),
  url,
  title,
  updatedAt,
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  mergeStateStatus: "BLOCKED",
  autoMergeRequest: null,
  latestOpinionatedReviews: { nodes: [] },
  reviewRequests: { nodes: [] },
  latest: { nodes: [] },
  ...more,
})
/** The newest commit's checks, each as it went: a check run's conclusion, or IN_PROGRESS while it runs. */
const mineChecks = (...went: string[]) => ({
  nodes: [
    {
      commit: {
        oid: "abc1234",
        statusCheckRollup: {
          state: went.includes("FAILURE") ? "FAILURE" : went.includes("IN_PROGRESS") ? "PENDING" : "SUCCESS",
          contexts: {
            totalCount: went.length,
            nodes: went.map(one =>
              one === "IN_PROGRESS" ? { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null } : { __typename: "CheckRun", status: "COMPLETED", conclusion: one },
            ),
          },
        },
      },
    },
  ],
})
// Found updated last first, as the searches sort them: 12 the person opened in all, 2 asked of them to review.
const MINE_ANSWER = JSON.stringify({
  data: {
    viewer: { login: "me" },
    requested: {
      issueCount: 2,
      nodes: [
        minePull("https://github.com/a/b/pull/15", "Bump deps", "2026-10-16T04:30:00Z", {
          author: { login: "bob" },
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] },
          latest: mineChecks("SUCCESS"),
        }),
        minePull("https://github.com/a/b/pull/12", "Add search", "2026-10-16T02:30:00Z", {
          author: { login: "alice" },
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] },
          latest: mineChecks("IN_PROGRESS", "SUCCESS"),
        }),
      ],
    },
    opened: {
      issueCount: 12,
      nodes: [
        minePull("https://github.com/o/r/pull/4", "Draft thing", "2026-10-16T04:00:00Z", { isDraft: true, mergeStateStatus: "DRAFT", latest: mineChecks("IN_PROGRESS") }),
        minePull("https://github.com/x/y/pull/9", "Waiting one", "2026-10-16T03:00:00Z", {
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "bob" } }] },
        }),
        minePull("https://github.com/x/y/pull/7", "Ready one", "2026-10-16T02:00:00Z", { mergeStateStatus: "CLEAN", latest: mineChecks("SUCCESS") }),
        minePull("https://github.com/o/r/pull/3", "Fix the build", "2026-10-16T01:00:00Z", {
          latest: mineChecks("FAILURE", "SUCCESS"),
          latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "bob" } }] },
        }),
      ],
    },
  },
})

test("the band above the prompt shows the person's open pull requests, the most pressing first, then those asked of them to review, a row each linked from its number", JA, async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: [], alias: "r" } } })
  const clock = mock.clock(on, { now: Date.parse("2026-10-16T05:00:00Z") })
  let isDown = false
  const github = fakeGitHub(on, [], undefined, () => (isDown ? { exitCode: 1, stderr: "HTTP 502: Bad Gateway" } : { stdout: MINE_ANSWER }))
  const searches = () => github.asked.filter(isMineSearch).length

  await $.command.run(CHECK)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: "Text", text: "GitHub: 自分の PR（12件中4件）" })).toBeDefined()
  // The second heading goes without saying whose band it is.
  expect((await band.find({ type: "Text", text: "レビュー依頼" }))?.text).toBe("レビュー依頼")
  // Each row as the person reads it: the test's drawing writes a link's URL before its text.
  const rows = (await band.findAll({ type: "Text", text: /^ {2}\S+#\d/ })).map(row => row.text.replace(/https:\/\/github\.com\/\S+?\/pull\/\d+/, ""))
  expect(rows).toEqual([
    // What fails first, then what can be merged now, what waits; the draft last. A registered repository by its alias.
    "  r#3  ✗ CI 1/2  ✓ 承認1  Fix the build",
    "  y#7  ● マージ可  Ready one",
    "  y#9  ○ レビュー待ち  Waiting one",
    "  r#4（下書き）  ◐ CI 0/1  Draft thing",
    // Those asked of the person, updated last first, with who opened each; that each awaits their review goes unsaid.
    "  b#15  bobさん  ✓ CI  Bump deps",
    "  b#12  aliceさん  ◐ CI 1/2  Add search",
  ])
  expect((await band.find({ type: "Link", text: "r#3" }))?.props).toMatchObject({ href: "https://github.com/o/r/pull/3" })
  expect(await $.command.run({ ...CHECK, args: "status" })).toMatchObject({ text: expect.stringContaining("\n自分の PR: 12件、レビュー依頼: 2件（/inbox pr）\n") })

  // Within the interval the answer kept is used; after it, GitHub is searched again.
  await $.command.run(CHECK)
  expect(searches()).toBe(1)
  await clock.advance(61_000)
  // A search that fails for now leaves what was shown.
  isDown = true
  await $.command.run(CHECK)
  expect(searches()).toBe(2)
  expect(await band.find({ type: "Text", text: "r#3  ✗ CI 1/2  ✓ 承認1  Fix the build" })).toBeDefined()
  expect(github.logs).toContain("gh-inbox: pull requests on github.com: HTTP 502: Bad Gateway")
})

test("with none open or asked, the band shows no pull requests", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [])
  await $.command.run(CHECK)
  expect(github.asked.filter(isMineSearch)).toHaveLength(1)
  expect(await (await $.ui.mount(BAND)).find({ type: "Text", text: /your pull requests|asked to review/ })).toBeUndefined()
})

test("turned off, the band shows none of the person's pull requests and GitHub is not searched", { options: { myPulls: false } }, async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [], undefined, () => ({ stdout: MINE_ANSWER }))
  await $.command.run(CHECK)
  expect(github.asked.filter(isMineSearch)).toHaveLength(0)
  expect(await (await $.ui.mount(BAND)).find({ type: "Text", text: /your pull requests|asked to review/ })).toBeUndefined()
})

test("the band speaks English by default", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: Date.parse("2026-10-16T05:00:00Z") })
  fakeGitHub(on, [], undefined, () => ({ stdout: MINE_ANSWER }))
  await $.command.run(CHECK)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: "Text", text: "GitHub: your pull requests (4 of 12)" })).toBeDefined()
  expect(await band.find({ type: "Text", text: "r#4 (draft)  ◐ CI 0/1  Draft thing" })).toBeDefined()
  expect((await band.find({ type: "Text", text: "asked to review" }))?.text).toBe("asked to review")
  expect(await band.find({ type: "Text", text: "b#12  alice  ◐ CI 1/2  Add search" })).toBeDefined()
})

test("with none of the person's own open, the band heads those asked of them as its own", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: Date.parse("2026-10-16T05:00:00Z") })
  const answer = JSON.parse(MINE_ANSWER)
  answer.data.opened = { issueCount: 0, nodes: [] }
  fakeGitHub(on, [], undefined, () => ({ stdout: JSON.stringify(answer) }))
  await $.command.run(CHECK)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: "Text", text: "GitHub: asked to review" })).toBeDefined()
  expect(await band.find({ type: "Text", text: /your pull requests/ })).toBeUndefined()
})

test("a token that may not read the teams asked to review is asked again without them, and so from then on", JA, async ($, on) => {
  mock.store(on, {})
  const clock = mock.clock(on, { now: Date.parse(COMMENT.created_at) + 5 * 60_000 })
  const refusal = {
    errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes to execute this query. The 'combinedSlug' field requires one of the following scopes: ['read:org']" }],
  }
  const answer = branchPull(COMMENT.created_at)
  const github = fakeGitHub(on, [[]], argv => {
    const query = argv.at(-1) ?? ""
    if (argv.includes("graphql") && query.includes("combinedSlug"))
      return { exitCode: 1, stdout: JSON.stringify(refusal), stderr: "gh: Your token has not been granted the required scopes to execute this query." }
    return answer(argv)
  })
  const lines: Array<string | undefined> = []
  on("ui.status", async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  const pullQueries = () => github.asked.filter(argv => argv.includes("graphql") && !isMineSearch(argv))

  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: #12  ✗ コンフリクト  ✗ CI 1/2  ✓ 承認2 | aliceさん「Looks good」5分前")
  expect(pullQueries().map(argv => (argv.at(-1) ?? "").includes("combinedSlug"))).toEqual([true, false])
  expect(github.logs.some(line => line.includes("asked without them now"))).toBe(true)
  // The search for the person's own pull requests on the same host goes without them too.
  expect(github.asked.filter(isMineSearch).map(argv => (argv.at(-1) ?? "").includes("combinedSlug"))).toEqual([false])

  await clock.advance(61_000)
  await $.command.run(CHECK)
  expect(pullQueries().map(argv => (argv.at(-1) ?? "").includes("combinedSlug"))).toEqual([true, false, false])
})
