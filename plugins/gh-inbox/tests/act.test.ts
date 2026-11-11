import { describe, expect, test } from "claude-code/testing"

import { actArgv, type MergeSettings, parseMergeWords, parseSettings, planMerge } from "../hooks/act"
import type { Pull } from "../hooks/github"
import { MESSAGES } from "../hooks/i18n"
import { pullStatus } from "../hooks/status"

const t = MESSAGES.ja
const URL = "https://github.com/o/r/pull/7"

function pullWith(changes: Partial<Pull>): Pull {
  return {
    ref: { host: "github.com", owner: "o", repo: "r", number: 7 },
    viewer: "me",
    title: "T",
    url: URL,
    state: "OPEN",
    mergedBy: null,
    closedBy: null,
    closedAt: null,
    comments: [],
    reviews: [],
    commits: [],
    head: "abc",
    checks: [],
    checksTotal: 0,
    ciState: null,
    mergeable: "MERGEABLE",
    mergeState: "CLEAN",
    isDraft: false,
    autoMerge: null,
    reviewDecision: null,
    verdicts: [],
    ...changes,
  }
}

const SETTINGS: MergeSettings = { methods: ["MERGE", "SQUASH"], preferred: "SQUASH", autoMergeAllowed: true }
const plan = (changes: Partial<Pull>, settings: MergeSettings = SETTINGS) => {
  const pull = pullWith(changes)
  return planMerge(t, pull, pullStatus(pull, {}, "ja"), settings)
}

describe("parseSettings", () => {
  test("the methods the repository allows, the one the person used last first", () => {
    const answer = (repository: object) => JSON.stringify({ data: { repository } })
    expect(
      parseSettings(answer({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true, autoMergeAllowed: false, viewerDefaultMergeMethod: "REBASE" })),
    ).toEqual({ methods: ["SQUASH", "REBASE"], preferred: "REBASE", autoMergeAllowed: false })
    // One used last that is no longer allowed: the first allowed instead.
    expect(parseSettings(answer({ mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false, viewerDefaultMergeMethod: "SQUASH" }))).toMatchObject({
      methods: ["MERGE"],
      preferred: "MERGE",
    })
    // A server that says nothing of its methods: all of them, GitHub refusing one it does not allow.
    expect(parseSettings(answer({}))).toEqual({ methods: ["MERGE", "SQUASH", "REBASE"], preferred: "MERGE", autoMergeAllowed: false })
  })

  test("GitHub's error is thrown in its own words", () => {
    expect(() => parseSettings(JSON.stringify({ errors: [{ message: "Could not resolve to a Repository" }] }))).toThrow("Could not resolve to a Repository")
  })
})

describe("planMerge", () => {
  test("merged at once when GitHub would, with a word where a check not required failed", () => {
    expect(plan({})).toEqual({ kind: "merge", notes: [] })
    expect(plan({ mergeState: "HAS_HOOKS" })).toEqual({ kind: "merge", notes: [] })
    expect(plan({ mergeState: "UNSTABLE" })).toEqual({ kind: "merge", notes: ["必須でないチェックが通っていません。"] })
  })

  test("blocked by a required review or check: auto-merge where it is allowed, refused where it is not", () => {
    const blocked = { mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" } as const
    expect(plan(blocked)).toEqual({ kind: "auto", notes: ["まだマージできません（○ レビュー待ち）。自動マージを設定すると、条件がそろったときにマージされます。"] })
    expect(plan(blocked, { ...SETTINGS, autoMergeAllowed: false })).toEqual({ refusal: "まだマージできません（○ レビュー待ち）。このリポジトリでは自動マージも使えません。" })
  })

  test("auto-merge already on is turned off instead", () => {
    expect(plan({ mergeState: "BLOCKED", autoMerge: "SQUASH" })).toEqual({ kind: "disable-auto", notes: ["自動マージが設定されています（スカッシュ）。条件がそろうとマージされます。"] })
  })

  test("a draft, a conflict, a base moved on, an unknown head or state are refused, never forced", () => {
    expect(plan({ isDraft: true, mergeState: "DRAFT" })).toEqual({ refusal: t.draftCannotMerge })
    expect(plan({ mergeable: "CONFLICTING", mergeState: "DIRTY" })).toEqual({ refusal: t.conflictsCannotMerge })
    expect(plan({ mergeState: "BEHIND" })).toEqual({ refusal: t.behindCannotMerge })
    expect(plan({ head: "" })).toEqual({ refusal: t.headUnknown })
    expect(plan({ mergeState: "UNKNOWN" })).toEqual({ refusal: t.mergeUnknown })
    expect(plan({}, { ...SETTINGS, methods: [] })).toEqual({ refusal: t.noMethods })
  })

  test("where GitHub said nothing of its state, mergeable is enough: GitHub refuses what branch protection does not allow", () => {
    expect(plan({ mergeState: null })).toEqual({ kind: "merge", notes: [] })
    expect(plan({ mergeState: null, mergeable: "UNKNOWN" })).toEqual({ refusal: t.mergeUnknown })
  })
})

test("actArgv: a merge goes only at the head commit confirmed, never past branch protection or deleting the branch", () => {
  expect(actArgv("merge", URL, "abc", "SQUASH")).toEqual(["gh", "pr", "merge", URL, "--squash", "--match-head-commit", "abc"])
  expect(actArgv("auto", URL, "abc", "REBASE")).toEqual(["gh", "pr", "merge", URL, "--rebase", "--match-head-commit", "abc", "--auto"])
  expect(actArgv("disable-auto", URL, "abc", null)).toEqual(["gh", "pr", "merge", URL, "--disable-auto"])
  expect(actArgv("close", URL, "abc", null)).toEqual(["gh", "pr", "close", URL])
  expect(actArgv("ready", URL, "abc", null)).toEqual(["gh", "pr", "ready", URL])
  expect(actArgv("draft", URL, "abc", null)).toEqual(["gh", "pr", "ready", URL, "--undo"])
  for (const kind of ["merge", "auto", "disable-auto", "close", "ready", "draft"] as const) {
    const argv = actArgv(kind, URL, "abc", "MERGE")
    expect(argv.some(word => word === "--admin" || word === "--delete-branch" || word === "-d")).toBe(false)
  }
})

test("parseMergeWords takes a method out of the words, whatever its case", () => {
  expect(parseMergeWords(["Squash", "o/r#7"])).toEqual({ method: "SQUASH", rest: ["o/r#7"] })
  expect(parseMergeWords(["12"])).toEqual({ method: undefined, rest: ["12"] })
})
