import type { On } from "claude-code"
import { describe, expect, mock, test } from "claude-code/testing"

import { ciContext, ciItem, ciKey, isResult, logCommand } from "../hooks/ci"
import { parseChecks } from "../hooks/github"
import { MESSAGES } from "../hooks/i18n"

const JA = { options: { language: "ja" } }
const REF = { host: "github.com", owner: "o", repo: "r", number: 12 }
const OID = "0123456789abcdef0123456789abcdef01234567"
const CHECK = { command: "inbox", args: "check", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 120 } } as const
const PROMPT = { wait: false, origin: { kind: "composer" } } as const
const PANE = {
  plugin: "gh-inbox",
  surface: "terminal",
  component: "Pane",
  requestId: "gh-inbox-pr",
  props: { title: "", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

/** A job of GitHub Actions' run 900, as the commit's checks list it: running while `conclusion` is null. */
const job = (id: number, name: string, conclusion: string | null, extra: Record<string, unknown> = {}) => ({
  __typename: "CheckRun",
  databaseId: id,
  name,
  status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  detailsUrl: `https://github.com/o/r/actions/runs/900/job/${id}`,
  title: null,
  checkSuite: { workflowRun: { databaseId: 900, workflow: { name: "CI" } } },
  steps: { nodes: conclusion === "FAILURE" ? [{ name: "Setup", conclusion: "SUCCESS" }, { name: "Run npm test", conclusion: "FAILURE" }] : [] },
  ...extra,
})
const ANNOTATED = job(11, "test", "FAILURE", {
  annotations: {
    totalCount: 2,
    nodes: [{ path: "src/a.ts", annotationLevel: "FAILURE", title: null, message: "Type 'string' is not assignable to type 'number'.", location: { start: { line: 12 } } }],
  },
})
const CIRCLE = { __typename: "StatusContext", id: "SC_1", context: "ci/circleci", state: "ERROR", description: "Your tests failed on CircleCI", targetUrl: "https://circleci.com/x" }
const MIXED = [ANNOTATED, CIRCLE, job(12, "lint", null), job(13, "build", "SUCCESS"), job(14, "deploy", "CANCELLED")]
const commit = (contexts: unknown[], oid = OID) => ({ oid, statusCheckRollup: { state: "FAILURE", contexts: { totalCount: contexts.length, nodes: contexts } } })

describe("what Claude reads of CI", () => {
  test("parseChecks reads which run and job of GitHub Actions a check is, what it reported, and a status's description", () => {
    const { oid, checks } = parseChecks(commit(MIXED))
    expect(oid).toBe(OID)
    expect(checks[0]).toMatchObject({ name: "CI / test", failedStep: "Run npm test", conclusion: "FAILURE", actions: { runId: 900, jobId: 11 }, annotationCount: 2 })
    expect(checks[0]?.annotations).toEqual([{ path: "src/a.ts", line: 12, level: "FAILURE", title: "", message: "Type 'string' is not assignable to type 'number'." }])
    expect(checks[1]).toMatchObject({ name: "ci/circleci", isFailed: true, conclusion: "ERROR", actions: null, summary: "Your tests failed on CircleCI" })
    expect(checks[2]).toMatchObject({ isPending: true, conclusion: "" })
    // A check of another app, linked elsewhere and with no workflow run, is no job of GitHub Actions.
    const [other] = parseChecks(commit([{ ...job(15, "app", "FAILURE"), detailsUrl: "https://app.example/1", checkSuite: { workflowRun: null } }])).checks
    expect(other?.actions).toBeNull()
  })

  test("a failure says each failed check with where to read its log, what it reported fenced, and names the rest", () => {
    const ci = { ...parseChecks(commit(MIXED)), total: 5 }
    expect(ciContext(MESSAGES.en, REF, ci)).toBe(
      [
        `### CI of commit ${OID}`,
        "2 of 5 checks failed; 1 still running.",
        "",
        'Failed: CI / test, at step "Run npm test"',
        "https://github.com/o/r/actions/runs/900/job/11",
        "Log of its failed steps: `gh run view --job 11 --log-failed -R o/r`",
        "```text",
        "src/a.ts:12 failure: Type 'string' is not assignable to type 'number'.",
        "```",
        "(1 more annotation not listed)",
        "",
        "Failed: ci/circleci (error)",
        "https://circleci.com/x",
        "```text",
        "Your tests failed on CircleCI",
        "```",
        "",
        "Still running (1): CI / lint",
        "Passed (1): CI / build",
        "Other (1): CI / deploy (cancelled)",
      ].join("\n"),
    )
    const ja = ciContext(MESSAGES.ja, REF, ci)
    expect(ja).toContain(`### コミット ${OID} の CI\n5件中2件が失敗しました（1件はまだ実行中）。`)
    expect(ja).toContain("失敗: CI / test、ステップ「Run npm test」")
    expect(ja).toContain("失敗したステップのログ: `gh run view --job 11 --log-failed -R o/r`")
    expect(ja).toContain("その他（1件）: CI / deploy（キャンセル）")
  })

  test("a pass names the commit it passed on", () => {
    const ci = { ...parseChecks(commit([job(13, "build", "SUCCESS"), job(16, "test", "SUCCESS")])), total: 2 }
    expect(ciContext(MESSAGES.en, REF, ci)).toBe(`### CI of commit ${OID}\nCI passed: none of its 2 checks failed.\n\nPassed (2): CI / build, CI / test`)
    expect(ciContext(MESSAGES.ja, REF, ci)).toContain("CI は通っています。2件とも失敗はありません。")
  })

  test("ciKey changes with what failed and with whether the rest still run; a result is a failure or all done", () => {
    const key = (contexts: unknown[]) => ciKey({ ...parseChecks(commit(contexts)), total: contexts.length })
    expect(key([])).toBeNull()
    expect(key([job(12, "lint", null)])).toBe(`${OID}:running`)
    expect(key([job(13, "build", "SUCCESS")])).toBe(`${OID}:done`)
    expect(key([job(11, "test", "FAILURE"), job(12, "lint", null)])).toBe(`${OID}:failed:run:11`)
    expect(isResult(key([job(12, "lint", null)]) ?? "")).toBe(false)
    expect(isResult(key([job(11, "test", "FAILURE"), job(12, "lint", null)]) ?? "")).toBe(true)
    expect(isResult(key([job(13, "build", "SUCCESS")]) ?? "")).toBe(true)
  })

  test("a list cut short is done only when GitHub's rollup of every check says it passed", () => {
    const cut = (state: string) => ({ ...parseChecks(commit([job(13, "build", "SUCCESS")])), state, total: 150 })
    expect(ciKey(cut("PENDING"))).toBe(`${OID}:running`)
    expect(ciKey(cut("FAILURE"))).toBe(`${OID}:running`)
    expect(ciKey(cut("SUCCESS"))).toBe(`${OID}:done`)
    expect(ciKey({ ...parseChecks(commit([job(11, "test", "FAILURE")])), state: "FAILURE", total: 150 })).toBe(`${OID}:failed:run:11`)
    expect(ciContext(MESSAGES.en, REF, cut("PENDING"))).toContain(
      "Only 1 of the 150 checks are listed, and none of them failed or still runs; GitHub rolls up all of them as pending.",
    )
    expect(ciContext(MESSAGES.ja, REF, cut("FAILURE"))).toContain("150件中1件だけを出しています。そのどれも失敗・実行中ではありませんが、GitHub は全体を「失敗」としています。")
    expect(ciContext(MESSAGES.en, REF, cut("SUCCESS"))).toContain("CI passed: none of its 150 checks failed.")
    expect(ciContext(MESSAGES.en, REF, cut("SUCCESS"))).toContain("(149 more checks not listed)")
    expect(ciItem(MESSAGES.en, REF, cut("PENDING"))?.label).toBe("◐ CI 1/150 0123456")
  })

  test("the pick item tells how CI stands at the head commit, what failed named", () => {
    const item = ciItem(MESSAGES.ja, REF, { ...parseChecks(commit(MIXED)), total: 5 })
    expect(item?.label).toBe("✗ CI 2/5 0123456: CI / test、ci/circleci")
    expect(item?.id).toBe(`ci:${OID}:failed:run:11,status:SC_1`)
    expect(ciItem(MESSAGES.en, REF, { ...parseChecks(commit([job(12, "lint", null), job(13, "build", "SUCCESS")])), total: 2 })?.label).toBe("◐ CI 1/2 0123456")
    expect(ciItem(MESSAGES.en, REF, { ...parseChecks(commit([])), total: 0 })).toBeNull()
  })

  test("the log command names the host of a GitHub Enterprise Server, and the run where the job is not known", () => {
    expect(logCommand({ ...REF, host: "ghe.example" }, { runId: 900, jobId: 11 })).toBe("gh run view --job 11 --log-failed -R ghe.example/o/r")
    expect(logCommand(REF, { runId: 900, jobId: null })).toBe("gh run view 900 --log-failed -R o/r")
  })
})

type Answer = { stdout?: string; stderr?: string; exitCode?: number }

/** The pull request of branch `feat`, o/r#12, its head commit's checks as `github.contexts` says, at `github.oid`. */
function fakeGitHub(on: On) {
  const github = { branch: "feat", oid: OID, contexts: [] as unknown[] }
  const pull = () => ({
    title: "Add CI",
    url: "https://github.com/o/r/pull/12",
    headRefOid: github.oid,
    state: "OPEN",
    closedAt: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    mergedBy: null,
    latestOpinionatedReviews: { nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    reviews: { totalCount: 0, nodes: [] },
    reviewThreads: { totalCount: 0, nodes: [] },
    commits: { nodes: [] },
    latest: { nodes: [{ commit: commit(github.contexts, github.oid) }] },
    head: { nodes: [{ commit: commit(github.contexts, github.oid) }] },
  })
  on("process.run", async (_$, e) => {
    const argv = [...e.argv]
    const answer = (): Answer => {
      if (argv[0] === "git") return { stdout: `${github.branch}\n` }
      if (argv.includes("pr") && argv.includes("view")) return { stdout: JSON.stringify({ url: "https://github.com/o/r/pull/12", state: "OPEN" }) }
      if (argv.includes("graphql")) return { stdout: JSON.stringify({ data: { viewer: { login: "me" }, repository: { pullRequest: pull() } } }) }
      return { exitCode: 1 }
    }
    const { stdout = "", stderr = "", exitCode = 0 } = answer()
    return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on("ui.open", async () => ({ value: { isPlaced: true } }))
  on("ui.close", async () => ({ value: undefined }))

  return github
}

/** Records the context of each prompt that reaches the engine. */
function sentContexts(on: On) {
  const contexts: Array<readonly string[] | undefined> = []
  on("prompt.submit", async (_$, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  return contexts
}

describe("CI told with a prompt", () => {
  test("a result goes once with the next prompt the person sends, and again only when CI has a new one", JA, async ($, on) => {
    mock.store(on, {})
    const clock = mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    const contexts = sentContexts(on)

    // While the checks still run with none failed, nothing is told.
    github.contexts = [job(12, "lint", null), job(13, "build", "SUCCESS")]
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts.at(-1)).toBeUndefined()

    github.contexts = [job(11, "test", "FAILURE"), job(12, "lint", null), job(13, "build", "SUCCESS")]
    await clock.advance(61_000)
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "直して" })
    const [told = ""] = contexts.at(-1) ?? []
    expect(told).toContain("ユーザーではなく gh-inbox mod が添えたもの")
    expect(told).toContain("o/r#12 \"Add CI\"（https://github.com/o/r/pull/12）")
    expect(told).toContain("3件中1件が失敗しました（1件はまだ実行中）。")
    expect(told).toContain("gh run view --job 11 --log-failed -R o/r")
    // Told once.
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts.at(-1)).toBeUndefined()

    // The rest finishing with nothing more failed is no new result.
    github.contexts = [job(11, "test", "FAILURE"), job(12, "lint", "SUCCESS"), job(13, "build", "SUCCESS")]
    await clock.advance(61_000)
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts.at(-1)).toBeUndefined()

    // A new commit passing is.
    github.oid = "fedcba9876543210fedcba9876543210fedcba98"
    github.contexts = [job(21, "test", "SUCCESS"), job(22, "lint", "SUCCESS")]
    await clock.advance(61_000)
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "どう？" })
    expect(contexts.at(-1)?.[0]).toContain("### コミット fedcba9876543210fedcba9876543210fedcba98 の CI\nCI は通っています。2件とも失敗はありません。")
  })

  test("a prompt that does not go keeps the result for the next one", JA, async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    github.contexts = [job(13, "build", "SUCCESS")]
    const contexts: Array<readonly string[] | undefined> = []
    on("prompt.submit", async (_$, e) => {
      contexts.push(e.context)
      return contexts.length === 1 ? { drop: "not now" } : { text: e.text }
    })

    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "どう？" })
    await $.prompt.submit({ ...PROMPT, text: "どう？" })
    expect(contexts.map(context => context?.length)).toEqual([1, 1])
  })

  test("CI of a branch switched away from is not told", JA, async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    github.contexts = [job(11, "test", "FAILURE")]
    const contexts = sentContexts(on)

    await $.command.run(CHECK)
    github.branch = "other"
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts[0]).toBeUndefined()
  })

  test("CI picked as it stands goes once, as picked", JA, async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    github.contexts = [ANNOTATED, job(13, "build", "SUCCESS")]
    const contexts = sentContexts(on)

    await $.command.run(CHECK)
    await $.command.run({ ...CHECK, args: "pr pick" })
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: "to:pick" })
    const key = `ci:${OID}:failed:run:11`
    expect((await pane.find({ key }))?.props.label).toBe("[ ] ✗ CI 1/2 0123456: CI / test")
    await pane.press({ key })
    await pane.press({ key: "stage" })
    await $.prompt.submit({ ...PROMPT, text: "直して" })
    expect(contexts[0]).toHaveLength(1)
    const [picked = ""] = contexts[0] ?? []
    expect(picked).toContain("GitHub の PR o/r#12")
    expect(picked).toContain("src/a.ts:12 failure: Type 'string' is not assignable to type 'number'.")
    expect(picked).not.toContain("gh-inbox mod が添えた")
    // Told by the pick, it is not told again.
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts[1]).toBeUndefined()
  })

  test("CI picked newer than the last check found counts as told, not told again once a check catches up", JA, async ($, on) => {
    mock.store(on, {})
    const clock = mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    const contexts = sentContexts(on)
    github.contexts = [job(12, "lint", null), job(13, "build", "SUCCESS")]
    await $.command.run(CHECK)

    // CI finishes before the next check, and the pick reads it so.
    github.contexts = [job(12, "lint", "SUCCESS"), job(13, "build", "SUCCESS")]
    await $.command.run({ ...CHECK, args: "pr pick" })
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: "to:pick" })
    await pane.press({ key: `ci:${OID}:done` })
    await pane.press({ key: "stage" })
    await $.prompt.submit({ ...PROMPT, text: "通った？" })
    expect(contexts[0]).toHaveLength(1)
    expect(contexts[0]?.[0]).not.toContain("gh-inbox mod が添えた")

    await clock.advance(61_000)
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts[1]).toBeUndefined()
  })

  test("after a pick told CI afresh, what the last check found before it is not told, nor the pick's once a check catches up", JA, async ($, on) => {
    mock.store(on, {})
    const clock = mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    const contexts = sentContexts(on)
    github.contexts = [job(11, "test", "FAILURE")]
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "直して" })
    expect(contexts[0]?.[0]).toContain("1件中1件が失敗しました。")

    // A new commit passes before the next check, and the pick reads it so.
    const NEW = "fedcba9876543210fedcba9876543210fedcba98"
    github.oid = NEW
    github.contexts = [job(21, "test", "SUCCESS")]
    await clock.advance(10_000)
    await $.command.run({ ...CHECK, args: "pr pick" })
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: "to:pick" })
    await pane.press({ key: `ci:${NEW}:done` })
    await pane.press({ key: "stage" })
    await $.prompt.submit({ ...PROMPT, text: "通った？" })
    expect(contexts[1]).toHaveLength(1)

    // The last check still holds the old commit's failure: older than what was told, it is not told.
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts[2]).toBeUndefined()
    await clock.advance(61_000)
    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "続けて" })
    expect(contexts[3]).toBeUndefined()
  })

  test("it can be turned off", { options: { language: "ja", ciToClaude: false } }, async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    github.contexts = [job(11, "test", "FAILURE")]
    const contexts = sentContexts(on)

    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "直して" })
    expect(contexts[0]).toBeUndefined()
  })

  test("in English by default", async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: 1_000_000 })
    const github = fakeGitHub(on)
    github.contexts = [job(13, "build", "SUCCESS")]
    const contexts = sentContexts(on)

    await $.command.run(CHECK)
    await $.prompt.submit({ ...PROMPT, text: "How is it?" })
    const [told = ""] = contexts[0] ?? []
    expect(told).toStartWith('The gh-inbox mod adds this, not the user: CI of GitHub pull request o/r#12 "Add CI" (https://github.com/o/r/pull/12)')
    expect(told).toContain(`### CI of commit ${OID}\nCI passed: its one check did not fail.`)
  })
})
