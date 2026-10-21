import { describe, expect, test } from "claude-code/testing"

import type { Pull } from "../hooks/github"
import { MESSAGES } from "../hooks/i18n"
import { pullStatus, statusParts } from "../hooks/status"

const ref = { host: "github.com", owner: "o", repo: "r", number: 7 }

function pullWith(changes: Partial<Pull>): Pull {
  return {
    ref,
    viewer: "me",
    title: "T",
    url: "",
    state: "OPEN",
    mergedBy: null,
    closedBy: null,
    closedAt: null,
    comments: [],
    reviews: [],
    commits: [],
    checks: [],
    ciState: null,
    mergeable: "UNKNOWN",
    reviewDecision: null,
    verdicts: [],
    ...changes,
  }
}

const check = (id: string, isFailed: boolean, isPending = false) => ({ id, name: id, isFailed, isPending, failedStep: null, url: "" })
const parts = (pull: Pull, language: "en" | "ja" = "ja") =>
  statusParts(MESSAGES[language], 7, pull.state, pullStatus(pull, { "long-name": "ロン" }, language), () => "3分前")

describe("pullStatus and statusParts", () => {
  test("CI, approvals, conflicts and the newest comment, in Japanese", async () => {
    const pull = pullWith({
      checks: [check("a", false), check("b", false)],
      ciState: "SUCCESS",
      verdicts: ["APPROVED", "APPROVED", "CHANGES_REQUESTED"],
      mergeable: "CONFLICTING",
      comments: [
        { id: "c1", author: "a", body: "old", at: "2026-01-01T00:00:00Z", url: "" },
        { id: "c2", author: "long-name", body: "## **この** null チェック不要では", at: "2026-01-02T00:00:00Z", url: "" },
      ],
      reviews: [{ id: "r1", author: "b", state: "APPROVED", body: "", at: "2026-01-03T00:00:00Z", url: "", comments: [] }],
    })
    expect(parts(pull)).toEqual(["#7", "CI ✓", "承認2", "変更依頼1", "コンフリクト", "ロンさん「この null チェック不要では」 3分前"])
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

  test("CI failing or running, and a review still needed, in English", async () => {
    expect(parts(pullWith({ checks: [check("a", true), check("b", false)], ciState: "FAILURE", reviewDecision: "REVIEW_REQUIRED" }), "en")).toEqual([
      "#7",
      "CI ✗ 1/2",
      "review required",
    ])
    expect(parts(pullWith({ checks: [check("a", false, true), check("b", false)], ciState: "PENDING", verdicts: ["APPROVED"] }), "en")).toEqual([
      "#7",
      "CI … 1/2",
      "1 approval",
    ])
  })

  test("a merged pull request says so alone", async () => {
    expect(parts(pullWith({ state: "MERGED", mergeable: "CONFLICTING" }))).toEqual(["#7（マージ済み）"])
  })

  test("with nothing to tell, the number alone", async () => {
    expect(parts(pullWith({}))).toEqual(["#7"])
    expect(statusParts(MESSAGES.ja, 7, "OPEN", null, () => undefined)).toEqual(["#7"])
  })
})
