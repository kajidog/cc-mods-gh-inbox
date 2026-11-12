import { describe, expect, test } from "claude-code/testing"

import type { Pull } from "../hooks/github"
import { MESSAGES } from "../hooks/i18n"
import { pullStatus, statusMarks, statusParts, statusText } from "../hooks/status"

const ref = { host: "github.com", owner: "o", repo: "r", number: 7 }

function pullWith(changes: Partial<Pull>): Pull {
  return {
    ref,
    viewer: "me",
    author: "someone",
    title: "T",
    url: "",
    state: "OPEN",
    mergedBy: null,
    closedBy: null,
    closedAt: null,
    comments: [],
    reviews: [],
    commits: [],
    head: "",
    checks: [],
    checksTotal: 0,
    ciState: null,
    mergeable: "UNKNOWN",
    mergeState: null,
    isDraft: false,
    autoMerge: null,
    reviewDecision: null,
    verdicts: [],
    requested: [],
    ...changes,
  }
}

const check = (id: string, isFailed: boolean, isPending = false) => ({
  id,
  name: id,
  isFailed,
  isPending,
  failedStep: null,
  url: "",
  conclusion: isPending ? "" : isFailed ? "FAILURE" : "SUCCESS",
  actions: null,
  summary: "",
  annotations: [],
  annotationCount: 0,
})
const approved = (author: string) => ({ state: "APPROVED", author })
const line = (pull: Pull, language: "en" | "ja" = "ja") =>
  statusText(statusParts(MESSAGES[language], 7, pull.state, pullStatus(pull, { "long-name": "ロン" }, language), () => "3分前"))
const marks = (pull: Pull, language: "en" | "ja" = "ja") => statusMarks(MESSAGES[language], pullStatus(pull, {}, language))

describe("pullStatus, statusMarks and statusText", () => {
  test("a mark leads each part, what fails first and what passed last, the newest comment after a bar", async () => {
    const pull = pullWith({
      checks: [check("a", false), check("b", false)],
      ciState: "SUCCESS",
      verdicts: [approved("a"), approved("b"), { state: "CHANGES_REQUESTED", author: "c" }],
      mergeable: "CONFLICTING",
      comments: [
        { id: "c1", author: "a", body: "old", at: "2026-01-01T00:00:00Z", url: "" },
        { id: "c2", author: "long-name", body: "## **この** null チェック不要では", at: "2026-01-02T00:00:00Z", url: "" },
      ],
      reviews: [{ id: "r1", author: "b", state: "APPROVED", body: "", at: "2026-01-03T00:00:00Z", url: "", comments: [] }],
    })
    expect(line(pull)).toBe("#7  ✗ コンフリクト  ✗ 変更依頼1  ✓ CI  ✓ 承認2 | ロンさん「この null チェック不要では」3分前")
    expect(line(pull, "en")).toBe("#7  ✗ conflicts  ✗ 1 change request  ✓ CI  ✓ 2 approvals | ロン “この null チェック不要では” 3分前")
  })

  test("a line comment newer than the comments is the newest", async () => {
    const pull = pullWith({
      comments: [{ id: "c1", author: "a", body: "old", at: "2026-01-01T00:00:00Z", url: "" }],
      reviews: [
        {
          id: "r1",
          author: "b",
          state: "COMMENTED",
          body: "",
          at: "2026-01-02T00:00:00Z",
          url: "",
          comments: [{ id: "rc", author: "b", at: "2026-01-02T00:00:00Z", path: "a.ts", line: 1, hunk: "", body: "fix this", url: "" }],
        },
      ],
    })
    expect(pullStatus(pull, {}).latest).toMatchObject({ author: "b", body: "fix this" })
  })

  test("CI failing, running or passed, and a review still needed", async () => {
    expect(marks(pullWith({ checks: [check("a", true), check("b", false)], ciState: "FAILURE", reviewDecision: "REVIEW_REQUIRED" }), "en")).toEqual([
      "✗ CI 1/2",
      "○ awaiting review",
    ])
    expect(marks(pullWith({ checks: [check("a", false, true), check("b", false)], ciState: "PENDING", verdicts: [approved("a")] }), "en")).toEqual([
      "◐ CI 1/2",
      "✓ 1 approval",
    ])
    // Approved by one where the base asks for two: still waiting, the approval kept.
    expect(marks(pullWith({ checks: [check("a", false)], ciState: "SUCCESS", verdicts: [approved("a")], reviewDecision: "REVIEW_REQUIRED" }))).toEqual([
      "○ レビュー待ち",
      "✓ CI",
      "✓ 承認1",
    ])
  })

  test("one GitHub would merge now says so, CI's own mark left out", async () => {
    const ready = pullWith({ checks: [check("a", false)], ciState: "SUCCESS", verdicts: [approved("a")], mergeState: "CLEAN", mergeable: "MERGEABLE" })
    expect(marks(ready)).toEqual(["● マージ可", "✓ 承認1"])
    expect(marks(ready, "en")).toEqual(["● ready to merge", "✓ 1 approval"])
    // A check not required failing: mergeable, but not marked ready.
    expect(marks(pullWith({ checks: [check("a", true)], ciState: "FAILURE", mergeState: "UNSTABLE" }))).toEqual(["✗ CI 1/1"])
  })

  test("behind its base, blocked by a rule no part tells, auto-merge on", async () => {
    expect(marks(pullWith({ mergeState: "BEHIND" }))).toEqual(["✗ base より古い"])
    expect(marks(pullWith({ mergeState: "BLOCKED" }))).toEqual(["○ ルールでブロック中"])
    expect(marks(pullWith({ mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", autoMerge: "SQUASH" }))).toEqual(["○ レビュー待ち", "○ 自動マージ待ち"])
  })

  test("named, the reviews say who gave them and who is still asked; the line under the prompt counts them", async () => {
    const pull = pullWith({
      verdicts: [approved("a"), approved("long-name"), { state: "CHANGES_REQUESTED", author: "c" }],
      requested: [
        { login: "d", isTeam: false },
        { login: "o/core", isTeam: true },
      ],
      reviewDecision: "CHANGES_REQUESTED",
    })
    const status = pullStatus(pull, { "long-name": "ロン" }, "ja")
    expect(statusMarks(MESSAGES.ja, status, true)).toEqual(["✗ 変更依頼（cさん）", "○ レビュー待ち（dさん、@o/core）", "✓ 承認（aさん、ロンさん）"])
    expect(statusMarks(MESSAGES.ja, status)).toEqual(["✗ 変更依頼1", "○ レビュー待ち", "✓ 承認2"])
    expect(statusMarks(MESSAGES.en, pullStatus(pull, {}, "en"), true)).toEqual([
      "✗ changes requested by c",
      "○ awaiting review from d, @o/core",
      "✓ approved by a, long-name",
    ])
    expect(statusText(statusParts(MESSAGES.ja, 7, "OPEN", status, () => undefined, true))).toBe(
      "#7  ✗ 変更依頼（cさん）  ○ レビュー待ち（dさん、@o/core）  ✓ 承認（aさん、ロンさん）",
    )
    // Past three, the last named gives way to how many more.
    const many = pullStatus(pullWith({ verdicts: ["a", "b", "c", "d"].map(approved) }), {}, "ja")
    expect(statusMarks(MESSAGES.ja, many, true)).toEqual(["✓ 承認（aさん、bさん ほか2人）"])
    // A status kept from before the reviewers were asked for counts them.
    const { approvedBy: _, ...kept } = many
    expect(statusMarks(MESSAGES.ja, kept, true)).toEqual(["✓ 承認4"])
  })

  test("a review asked of someone the base does not require still waits, and leaves a block it does not explain said", async () => {
    const asked = [{ login: "d", isTeam: false }]
    expect(marks(pullWith({ requested: asked, mergeState: "BLOCKED" }))).toEqual(["○ レビュー待ち", "○ ルールでブロック中"])
    expect(
      marks(pullWith({ requested: asked, verdicts: [approved("a")], reviewDecision: "APPROVED", mergeState: "CLEAN", mergeable: "MERGEABLE" })),
    ).toEqual(["○ レビュー待ち", "● マージ可", "✓ 承認1"])
  })

  test("a draft says so after its number, and is not marked ready", async () => {
    const draft = pullWith({ isDraft: true, mergeState: "DRAFT", checks: [check("a", false, true), check("b", false)], ciState: "PENDING" })
    expect(line(draft)).toBe("#7（下書き）  ◐ CI 1/2")
    expect(line(draft, "en")).toBe("#7 (draft)  ◐ CI 1/2")
  })

  test("a merged pull request says so alone", async () => {
    expect(line(pullWith({ state: "MERGED", mergeable: "CONFLICTING" }))).toBe("#7（マージ済み）")
  })

  test("with nothing to tell, the number alone; without it, what follows", async () => {
    expect(line(pullWith({}))).toBe("#7")
    expect(statusText(statusParts(MESSAGES.ja, 7, "OPEN", null, () => undefined))).toBe("#7")
    expect(statusText({ head: "#7", marks: ["✓ CI"], latest: "aさん「x」" }, false)).toBe("✓ CI | aさん「x」")
    expect(statusText({ head: "#7", marks: [], latest: "aさん「x」" }, false)).toBe("aさん「x」")
  })
})
