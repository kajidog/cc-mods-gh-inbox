import type { On, RenderElement } from "claude-code"
import { expect, mock, test } from "claude-code/testing"

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

/**
 * Answers `gh` as GitHub would for o/r: the events in `answers` one call after
 * another, then a `304` while the ETag asked with is the one last given.
 * `other` answers first where it returns something.
 */
function fakeGitHub(on: On, answers: unknown[][], other: (argv: string[]) => Answer | undefined = () => undefined) {
  const asked: string[][] = []
  const toasts: string[] = []
  const logs: string[] = []
  let given = 0
  on("process.run", async (_$, e) => {
    const argv = [...e.argv]
    asked.push(argv)
    const done = (stdout: string, exitCode = 0, stderr = "") => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    const answered = other(argv)
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
  const LOG = { ...CHECK, args: "log" }
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
  const queries = github.asked.filter(argv => argv.includes("graphql")).map(argv => argv.at(-1) ?? "")
  expect(queries.map(query => query.match(/pullRequest\(/g)?.length)).toEqual([50, 10])
  expect(await $.command.run({ ...CHECK, args: "log" })).toMatchObject({ text: expect.stringContaining("#60 t60") })
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
  expect((await $.command.run({ ...CHECK, args: "log" })).text?.match(/CI が失敗しました/g)).toHaveLength(8)
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
  expect(await $.command.run({ ...CHECK, args: "log" })).toMatchObject({ text: expect.stringContaining("botさん") })
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
  expect(await $.command.run({ ...CHECK, args: "log" })).toEqual({
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
  expect(await $.command.run({ ...CHECK, args: "log" })).toMatchObject({ text: expect.stringContaining("Looks good") })
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
  expect(await $.command.run({ ...CHECK, args: "log" })).toMatchObject({ text: expect.stringContaining("Looks good") })
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
  expect(await $.command.run({ ...CHECK, args: "log" })).toMatchObject({ text: expect.stringContaining("newest") })
})

test("/inbox log lists what other sessions listed", JA, async ($, on) => {
  const event = { id: "x", kind: "comment", pull: "o/r#3", author: "a", at: "2026-10-16T23:00:00Z", text: "elsewhere", url: "u", items: [] }
  mock.store(on, { "history:other": { at: 1, events: [event] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  expect(await $.command.run({ ...CHECK, args: "log" })).toEqual({ text: "elsewhere\n  u（1時間前）" })
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
  const colored = (await log.findAll({ type: "Text" })).filter(text => text.props.color !== undefined)
  expect(colored.map(text => [text.props.color, text.children.join("")])).toEqual([["suggestion", "[r]"]])
  expect(await log.find({ type: "Text", text: "（1日前）" })).toBeDefined()
  expect(await log.find({ type: "Text", text: " (2h ago)" })).toBeDefined()
  // One with no URL is drawn as text, the others still links.
  expect(await log.find({ type: "Text", text: "no url（3日前）" })).toBeDefined()

  // Any other row is the engine's own.
  expect(await (await row("log", "通知はまだありません。")).find({ text: "engine's own" })).toBeDefined()
  expect(await (await row("status", "[r] a\n  https://x")).find({ text: "engine's own" })).toBeDefined()
})

test("/inbox log links what was done, a nickname's own words not taken for it", async ($, on) => {
  const event = {
    id: "x",
    kind: "comment",
    pull: "o/r#3",
    author: "a",
    who: "Team commented",
    at: "2026-10-16T23:00:00Z",
    text: "[r] Team commented commented on #3: hi",
    url: "https://github.com/o/r/pull/3",
    items: [],
  }
  mock.store(on, { "history:other": { at: 1, events: [event] } })
  mock.clock(on, { now: Date.parse("2026-10-17T00:00:00Z") })
  fakeGitHub(on, [[]])

  const { text = "" } = await $.command.run({ ...CHECK, args: "log" })
  const log = await $.ui.mount({ plugin: "gh-inbox", surface: "terminal", component: "CommandOutput", props: { command: "inbox", args: "log", text, isErrored: false } })
  const links = await log.findAll({ type: "Link" })
  expect(links.map(link => link.children.join(""))).toEqual(["commented on #3"])
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
  expect(lines.at(-1)).toBe("GitHub: r 5分前 · quiet -")
  await clock.advance(55 * 60_000)
  await $.command.run(CHECK)
  expect(lines.at(-1)).toBe("GitHub: r 1時間前 · quiet -")
  await $.command.run({ ...CHECK, args: "repo remove o/r" })
  expect(lines.at(-1)).toBe("GitHub: quiet -")
  await $.command.run({ ...CHECK, args: "repo remove o/quiet" })
  expect(lines.at(-1)).toBeUndefined()
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
