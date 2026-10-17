import type { On } from "claude-code"
import { expect, mock, test } from "claude-code/testing"

import { RUNS } from "./fixtures/repo-answers"

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

test("a registered repository notifies only what came after its first look, and a 304 changes nothing", async ($, on) => {
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

test("within the poll interval the shared answer is used, GitHub not asked", async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: ["comment"] } } })
  const clock = mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]])

  await $.command.run(CHECK)
  await clock.advance(10_000)
  await $.command.run(CHECK)
  expect(github.asked.filter(argv => (argv.at(-1) ?? "").includes("/events"))).toHaveLength(1)
})

test("the picker turns kinds on and off, saved at once", async ($, on) => {
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

test("runs that cannot be read leave the other notices coming, the error shown", async ($, on) => {
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

test("a repository with no kind chosen is not asked about", async ($, on) => {
  mock.store(on, { repos: { [KEY]: { kinds: [] } } })
  mock.clock(on, { now: 1_000_000 })
  const github = fakeGitHub(on, [[]])

  await $.command.run(CHECK)
  expect(github.asked.filter(argv => (argv.at(-1) ?? "").includes("/events"))).toHaveLength(0)
  expect(await $.command.run({ ...CHECK, args: "repo" })).toMatchObject({ text: expect.stringContaining("種類を選ぶまで確認しません") })
})

test("a push whose compare fails for now is told at a later check, with its commits", async ($, on) => {
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

test("a repository is registered as GitHub spells it and found whatever the case typed", async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 1_000_000 })
  fakeGitHub(on, [[]], argv => (argv.includes(".full_name") ? { stdout: "Owner/Repo\n" } : undefined))

  expect(await $.command.run({ ...CHECK, args: "repo add owner/repo comment" })).toEqual({ text: "Owner/Repo を登録しました（PR・Issue へのコメント）。" })
  expect(await $.command.run({ ...CHECK, args: "repo add OWNER/REPO" })).toMatchObject({ text: expect.stringContaining("Owner/Repo は登録済みです") })
  expect(await $.command.run({ ...CHECK, args: "repo remove owner/repo" })).toEqual({ text: "Owner/Repo の登録を外しました。" })
})
