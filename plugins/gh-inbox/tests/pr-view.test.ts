import type { GhPickItem, GhPullStatus } from "../types"
import { expect, test } from "claude-code/testing"

import { cardColor, conversationOf, cutBody, markColor, standingColor } from "../hooks/pr-view"

const STATUS: GhPullStatus = { ci: null, approvals: 0, changesRequested: 0, reviewDecision: null, mergeable: "MERGEABLE", latest: null }

test("each part of where a pull request stands is colored by its mark", () => {
  expect(["✗ CI 1/2", "◐ CI 1/2", "○ レビュー待ち", "● マージ可", "✓ 承認1", "#12"].map(markColor)).toEqual(["error", "warning", "permission", "success", "success", undefined])
})

test("the card of where it stands is colored by the most pressing part, merged, closed or a draft by that alone", () => {
  const open = { state: "OPEN", status: STATUS } as const
  expect(standingColor(open, ["○ レビュー待ち", "✗ CI 1/2", "✓ 承認1"])).toBe("error")
  // That it can be merged now weighs more than what waits beside it, as the band ranks them.
  expect(standingColor(open, ["○ レビュー待ち", "● マージ可"])).toBe("success")
  expect(standingColor(open, ["◐ CI 1/2", "○ レビュー待ち"])).toBe("warning")
  expect(standingColor(open, ["○ レビュー待ち"])).toBe("permission")
  expect(standingColor(open, [])).toBe("subtle")
  expect(standingColor({ state: "MERGED", status: STATUS }, ["✗ CI 1/2"])).toBe("merged")
  expect(standingColor({ state: "CLOSED", status: STATUS }, [])).toBe("inactive")
  expect(standingColor({ state: "OPEN", status: { ...STATUS, isDraft: true } }, ["✗ CI 1/2"])).toBe("inactive")
})

test("a card is colored by what its review says, whether its thread is still open, how its CI went", () => {
  const card = (more: object) => ({ kind: "review", who: "rev", at: "", body: "", url: "", ...more }) as const
  expect(cardColor(card({ state: "APPROVED" }))).toBe("success")
  expect(cardColor(card({ state: "CHANGES_REQUESTED" }))).toBe("error")
  expect(cardColor(card({ state: "COMMENTED" }))).toBe("subtle")
  expect(cardColor(card({ state: "DISMISSED" }))).toBe("inactive")
  expect(cardColor(card({ kind: "thread" }))).toBe("warning")
  expect(cardColor(card({ kind: "thread", isResolved: true }))).toBe("inactive")
  expect(cardColor(card({ kind: "thread", isOutdated: true }))).toBe("inactive")
  expect(cardColor(card({ kind: "ci", state: "failed" }))).toBe("error")
  expect(cardColor(card({ kind: "ci", state: "running" }))).toBe("warning")
  expect(cardColor(card({ kind: "ci", state: "passed" }))).toBe("success")
  expect(cardColor(card({ kind: "comment" }))).toBe("subtle")
  // One kept from before cards were drawn.
  expect(cardColor(undefined)).toBe("subtle")
})

test("a folded card shows the first lines of what was written, a code block it cut through closed again", () => {
  expect(cutBody("one\ntwo", 6)).toEqual({ shown: "one\ntwo", left: 0 })
  expect(cutBody("1\n2\n3\n4\n5", 3)).toEqual({ shown: "1\n2\n3", left: 2 })
  expect(cutBody("text\n```ts\nconst a = 1\nconst b = 2\n```\nafter", 3)).toEqual({ shown: "text\n```ts\nconst a = 1\n```", left: 3 })
  // A block closed within what shows is not closed again; a longer fence closes only with as long a one.
  expect(cutBody("````\n```\n````\n1\n2", 4)).toEqual({ shown: "````\n```\n````\n1", left: 1 })
  // A few long lines are cut by characters, however few lines they are.
  const long = cutBody(["a".repeat(300), "b".repeat(300), "c"].join("\n"), 6, 500)
  expect(long).toEqual({ shown: "a".repeat(300), left: 2 })
  expect(cutBody("x".repeat(600), 6, 500)).toEqual({ shown: "x".repeat(600), left: 0 })
  expect(cutBody(`${"x".repeat(600)}\ny`, 6, 500)).toEqual({ shown: `${"x".repeat(499)}…`, left: 1 })
})

test("the conversation holds each review with its threads under it, each comment, and threads of no review listed; not CI nor the description", () => {
  const item = (id: string, kind: string, parent?: string): GhPickItem => ({
    id,
    label: id,
    context: id,
    ...(parent === undefined ? {} : { parent }),
    card: { kind: kind as "review", who: "", at: "", body: "", url: "" },
  })
  const items = [item("ci", "ci"), item("D", "description"), item("C1", "comment"), item("R1", "review"), item("T1", "thread", "R1"), item("T2", "thread", "R1"), item("T9", "thread", "R9")]
  expect(conversationOf(items).map(({ item: one, threads }) => [one.id, threads.map(thread => thread.id)])).toEqual([
    ["C1", []],
    ["R1", ["T1", "T2"]],
    ["T9", []],
  ])
})
