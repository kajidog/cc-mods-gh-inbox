import type { On } from "claude-code"
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
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("another repository") })
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
