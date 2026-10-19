import { expect, test } from "claude-code/testing"

import type { GhEvent } from "../types"

import { HISTORY_KEPT, latest, mergeHistories, toKept, unheld } from "../hooks/history"

const event = (id: string, at: string, pull = "o/r#1", url = "https://github.com/o/r/pull/1"): GhEvent => ({
  id,
  kind: "comment",
  pull,
  author: "a",
  at,
  text: id,
  url,
  items: [{ body: "long body", url: `${url}#${pull}-${id}` }],
})

test("a notice another session listed already is listed once, the same repository on another host apart", async () => {
  const held = [event("1", "2026-10-16T00:00:00Z")]
  const added = [
    event("1", "2026-10-16T00:00:00Z"),
    event("1", "2026-10-16T00:00:00Z", "o/r#2"),
    event("1", "2026-10-16T00:00:00Z", "o/r#1", "https://ghe.example.com/o/r/pull/1"),
    event("2", "2026-10-16T01:00:00Z"),
  ]
  expect(unheld(held, added).map(one => `${one.url} ${one.pull} ${one.id}`)).toEqual([
    "https://github.com/o/r/pull/1 o/r#2 1",
    "https://ghe.example.com/o/r/pull/1 o/r#1 1",
    "https://github.com/o/r/pull/1 o/r#1 2",
  ])
  expect(mergeHistories([held, added])).toHaveLength(4)
})

test("a merge told by the branch's pull request and by its registered repository is listed once", async () => {
  const fromPull = [event("state:merged", "2026-10-16T00:00:00Z", "o/r#3"), event("state:closed", "2026-10-16T00:00:00Z", "o/r#4")]
  const fromRepo = [event("merged:#3", "2026-10-16T00:00:00Z", "o/r#3"), event("closed:#4", "2026-10-16T00:00:00Z", "o/r#4")]
  expect(mergeHistories([fromPull, fromRepo])).toHaveLength(2)
})

test("a session keeps its newest notices by when they happened, an old batch caught up late included, without their bodies", async () => {
  const recent = Array.from({ length: HISTORY_KEPT }, (_, i) => event(`new${i}`, `2026-10-17T00:00:${String(i % 60).padStart(2, "0")}Z`))
  const old = Array.from({ length: 10 }, (_, i) => event(`old${i}`, "2026-10-01T00:00:00Z"))
  const kept = toKept([...recent, ...old], 5)
  expect(kept.at).toBe(5)
  expect(kept.events).toHaveLength(HISTORY_KEPT)
  expect(kept.events.some(one => one.id.startsWith("old"))).toBe(false)
  expect(kept.events.every(one => one.items.length === 1 && one.items.every(item => item.body === "" && item.url !== ""))).toBe(true)
})

test("a review told with its line comments and the line comment told alone are listed once; so are a run of commits and their push", async () => {
  const comment = "https://github.com/o/r/pull/3#discussion_r1"
  const commit = (sha: string) => `https://github.com/o/r/commit/${sha}`
  const fromPull: GhEvent[] = [
    { ...event("PRR_1", "2026-10-16T00:00:00Z", "o/r#3"), kind: "review", items: [{ body: "", url: comment }] },
    { ...event("c2", "2026-10-16T01:00:00Z", "o/r#3"), kind: "commit", items: [{ body: "", url: commit("c1") }, { body: "", url: commit("c2") }] },
  ]
  const fromRepo: GhEvent[] = [
    { ...event("PRRC_1", "2026-10-16T00:00:00Z", "o/r#3"), items: [{ body: "", url: comment }] },
    { ...event("event:9", "2026-10-16T01:00:00Z", "o/r"), kind: "push", items: [{ body: "", url: commit("c1") }, { body: "", url: commit("c2") }] },
    // Another comment of the same pull request is another notice.
    { ...event("PRRC_2", "2026-10-16T02:00:00Z", "o/r#3"), items: [{ body: "", url: "https://github.com/o/r/pull/3#discussion_r2" }] },
  ]
  expect(mergeHistories([fromPull, fromRepo]).map(one => one.id)).toEqual(["PRR_1", "c2", "PRRC_2"])
  // What a session keeps still tells them apart.
  expect(mergeHistories([toKept(fromPull, 1).events, toKept(fromRepo, 1).events]).map(one => one.id)).toEqual(["PRR_1", "c2", "PRRC_2"])
})

test("latest lists by when it happened, one with no time beside the one added before it", async () => {
  const history = [event("b", "2026-10-16T02:00:00Z"), event("none", ""), event("a", "2026-10-16T01:00:00Z"), event("c", "2026-10-16T03:00:00Z")]
  expect(latest(history, 10).map(one => one.id)).toEqual(["a", "b", "none", "c"])
  expect(latest(history, 2).map(one => one.id)).toEqual(["none", "c"])
})
