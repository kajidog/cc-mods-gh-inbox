import { expect, test } from "claude-code/testing"

import type { GhEvent } from "../types"

import { latestArgv, latestKey, latestWanted, parseLatest, withLatest } from "../hooks/latest"

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

test("latestArgv asks in one GraphQL request, another host by its name", async () => {
  expect(latestArgv("github.com", ["IC_1", "PRRC_2"]).at(-1)).toBe(
    'query=query { nodes(ids: ["IC_1", "PRRC_2"]) { ... on Comment { body lastEditedAt } } }',
  )
  expect(latestArgv("ghe.example.com", ["IC_1"]).slice(0, 4)).toEqual(["gh", "api", "--hostname", "ghe.example.com"])
})

test("parseLatest tells an edit, a deletion, and leaves out what failed for now", async () => {
  const answer = JSON.stringify({
    data: { nodes: [{ body: "new", lastEditedAt: "2026-10-17T00:00:00Z" }, null, { body: "same", lastEditedAt: null }, null] },
    errors: [{ type: "NOT_FOUND", path: ["nodes", 1], message: "Could not resolve to a node" }, { type: "FORBIDDEN", path: ["nodes", 3] }],
  })
  expect([...parseLatest("github.com", ["IC_1", "IC_2", "IC_3", "IC_4"], answer)]).toEqual([
    ["github.com|IC_1", { state: "edited", body: "new", editedAt: "2026-10-17T00:00:00Z" }],
    ["github.com|IC_2", { state: "deleted" }],
    ["github.com|IC_3", { state: "same" }],
  ])
})

test("withLatest puts what an edited comment says now in place of what it said, its place kept", async () => {
  const edited = { state: "edited", body: "now <!-- hidden -->", editedAt: "" } as const
  const items = [{ body: "then", path: "a.ts", line: 3, url: "u" }, { body: "other", url: "v" }]
  expect(withLatest({ url: "u" }, items, edited)).toEqual([{ body: "now", path: "a.ts", line: 3, url: "u" }, { body: "other", url: "v" }])
  expect(withLatest({ url: "w" }, items, edited)[0]).toEqual({ body: "now", url: "w" })
  expect(withLatest({ url: "u" }, items, { state: "deleted" })).toEqual(items)
})
