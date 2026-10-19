import { expect, test } from "claude-code/testing"

import type { GhEvent } from "../types"

import { addToHistory, HISTORY_KEPT, latest, unheld } from "../hooks/history"

const event = (id: string, at: string, pull = "o/r#1"): GhEvent => ({ id, kind: "comment", pull, author: "a", at, text: id, url: "u", items: [] })

test("a notice another session added already is not added twice; the newest are kept", async () => {
  const held = [event("1", "2026-10-16T00:00:00Z")]
  const added = [event("1", "2026-10-16T00:00:00Z"), event("1", "2026-10-16T00:00:00Z", "o/r#2"), event("2", "2026-10-16T01:00:00Z")]
  expect(unheld(held, added).map(one => `${one.pull} ${one.id}`)).toEqual(["o/r#2 1", "o/r#1 2"])
  expect(addToHistory(held, added)).toHaveLength(3)

  const many = Array.from({ length: HISTORY_KEPT + 5 }, (_, i) => event(String(i), "2026-10-16T00:00:00Z"))
  expect(addToHistory([], many).at(0)?.id).toBe("5")
})

test("latest lists by when it happened, one with no time beside the one added before it", async () => {
  const history = [event("b", "2026-10-16T02:00:00Z"), event("none", ""), event("a", "2026-10-16T01:00:00Z"), event("c", "2026-10-16T03:00:00Z")]
  expect(latest(history, 10).map(one => one.id)).toEqual(["a", "b", "none", "c"])
  expect(latest(history, 2).map(one => one.id)).toEqual(["none", "c"])
})
