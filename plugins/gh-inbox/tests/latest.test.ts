import { expect, test } from "claude-code/testing"

import type { GhEvent } from "../types"

import { changeOf, type Latest, latestArgv, latestKey, latestWanted, parseLatest } from "../hooks/latest"

const event = (id: string, kind: GhEvent["kind"], url = "https://github.com/o/r/pull/3#c"): GhEvent => ({
  id,
  kind,
  pull: "o/r#3",
  author: "a",
  at: "2026-10-16T00:00:00Z",
  text: id,
  url,
  items: [],
})

test("only comments and reviews by their node ids are asked for, once each, by host", async () => {
  expect(latestKey(event("IC_1", "comment"))).toBe("github.com|IC_1")
  expect(latestKey(event("PRR_1", "review"))).toBe("github.com|PRR_1")
  expect(latestKey(event("run:1", "ci"))).toBeUndefined()
  expect(latestKey(event("abc123", "commit"))).toBeUndefined()
  expect(latestKey(event("IC_2", "comment", "u"))).toBeUndefined()

  const events = [event("IC_1", "comment"), event("IC_1", "comment"), event("IC_2", "comment"), event("IC_3", "comment", "https://ghe.example.com/o/r/pull/3#c")]
  expect([...latestWanted(events, new Set(["github.com|IC_2"]))]).toEqual([
    ["github.com", ["IC_1"]],
    ["ghe.example.com", ["IC_3"]],
  ])
})

test("latestArgv asks in one GraphQL request, a review's line comments with it, another host by its name", async () => {
  const query = latestArgv("github.com", ["IC_1", "PRR_2"]).at(-1) ?? ""
  expect(query.startsWith('query=query { nodes(ids: ["IC_1", "PRR_2"]) { ... on Comment { body lastEditedAt }')).toBe(true)
  expect(query).toContain("... on PullRequestReview { comments(first: 100) { totalCount nodes { url body lastEditedAt } } }")
  expect(latestArgv("ghe.example.com", ["IC_1"]).slice(0, 4)).toEqual(["gh", "api", "--hostname", "ghe.example.com"])
})

test("parseLatest reads a body, a review's line comments, a deletion, and leaves out what failed for now", async () => {
  const answer = JSON.stringify({
    data: {
      nodes: [
        { body: "new", lastEditedAt: "2026-10-17T00:00:00Z" },
        null,
        { body: "", lastEditedAt: null, comments: { totalCount: 1, nodes: [{ url: "c", body: "x", lastEditedAt: null }] } },
        null,
      ],
    },
    errors: [{ type: "NOT_FOUND", path: ["nodes", 1], message: "Could not resolve to a node" }, { type: "FORBIDDEN", path: ["nodes", 3] }],
  })
  expect([...parseLatest("github.com", ["IC_1", "IC_2", "PRR_3", "IC_4"], answer)]).toEqual([
    ["github.com|IC_1", { state: "found", body: "new", editedAt: "2026-10-17T00:00:00Z" }],
    ["github.com|IC_2", { state: "deleted" }],
    ["github.com|PRR_3", { state: "found", body: "", editedAt: null, comments: [{ url: "c", body: "x", editedAt: null }], isComplete: true }],
  ])
})

test("a comment edited since it was told says what it says now; one edited before it was told is no change", async () => {
  const told = { url: "u", text: "a commented: fixed", items: [{ body: "fixed", url: "u" }] }
  expect(changeOf(told, { state: "found", body: "fixed <!-- x -->", editedAt: "2026-10-16T00:00:00Z" })).toBeUndefined()
  expect(changeOf(told, { state: "found", body: "fixed again", editedAt: "2026-10-17T00:00:00Z" })).toEqual({
    isDeleted: false,
    editedAt: "2026-10-17T00:00:00Z",
    isPartDeleted: false,
    items: [{ body: "fixed again", url: "u", note: "edited" }],
  })
  // What the log cut short is compared as far as it kept it; a body that ends in "…" of its own, in full.
  const cut = `${"x".repeat(1999)}…`
  expect(changeOf({ url: "u", text: "a commented: x…", items: [{ body: cut, url: "u" }] }, { state: "found", body: `${"x".repeat(1999)}yz`, editedAt: "t" })).toBeUndefined()
  expect(changeOf({ url: "u", text: "a commented: Working…", items: [{ body: "Working…", url: "u" }] }, { state: "found", body: "Working on it", editedAt: "t" })).toMatchObject({
    items: [{ body: "Working on it", url: "u", note: "edited" }],
  })
  expect(changeOf(told, { state: "deleted" })).toMatchObject({ isDeleted: true })
  expect(changeOf(told, undefined)).toBeUndefined()
})

test("a review's line comments edited or deleted since it was told are told apart, by their URLs", async () => {
  const review = {
    url: "r",
    text: "a requested changes (2 comments): Please",
    items: [
      { body: "Please", url: "r" },
      { body: "Rename", path: "a.ts", line: 3, url: "c1" },
      { body: "Drop", path: "b.ts", line: 4, url: "c2" },
    ],
  }
  const now = (comments: Array<{ url: string; body: string; editedAt: string | null }>, isComplete = true) =>
    ({ state: "found", body: "Please", editedAt: null, comments, isComplete }) as const
  expect(changeOf(review, now([{ url: "c1", body: "Rename it", editedAt: "t1" }]))).toEqual({
    isDeleted: false,
    editedAt: "t1",
    isPartDeleted: true,
    items: [
      { body: "Please", url: "r" },
      { body: "Rename it", path: "a.ts", line: 3, url: "c1", note: "edited" },
      { body: "Drop", path: "b.ts", line: 4, url: "c2", note: "deleted" },
    ],
  })
  // With more line comments than were answered, one missing is not taken for deleted.
  expect(changeOf(review, now([{ url: "c1", body: "Rename", editedAt: null }], false))).toBeUndefined()
})

test("a review told with no words that has some now is edited; a notice kept with none is compared by its line", async () => {
  const now: Latest = { state: "found", body: "Ship it", editedAt: "t", comments: [], isComplete: true }
  expect(changeOf({ url: "r", text: "a approved.", items: [] }, now)).toEqual({
    isDeleted: false,
    editedAt: "t",
    isPartDeleted: false,
    items: [{ body: "Ship it", url: "r", note: "edited" }],
  })
  expect(changeOf({ url: "r", text: "a approved: Ship it", items: [] }, now)).toBeUndefined()
  expect(changeOf({ url: "r", text: "a approved.", items: [] }, { ...now, body: "" })).toBeUndefined()
})

test("a comment kept as nothing (an HTML comment alone) that says something now is edited; one cut for room is not told apart", async () => {
  const now: Latest = { state: "found", body: "Now with words", editedAt: "t" }
  expect(changeOf({ url: "u", text: "a commented.", items: [{ body: "", url: "u" }] }, now)).toMatchObject({
    editedAt: "t",
    items: [{ body: "Now with words", url: "u", note: "edited" }],
  })
  const review: Latest = { state: "found", body: "x".repeat(2100), editedAt: null, comments: [{ url: "c", body: "Changed", editedAt: "t" }], isComplete: true }
  const told = { url: "r", text: "a reviewed", items: [{ body: `${"x".repeat(1999)}…`, url: "r" }, { body: "", path: "a.ts", line: 1, url: "c" }] }
  expect(changeOf(told, review)).toBeUndefined()
})
