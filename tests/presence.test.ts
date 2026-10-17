import { expect, test } from "claude-code/testing"

import { pickActive, toPresence } from "../hooks/presence"

const minute = 60 * 1000

test("the session touched last among the alive ones shows notices", async () => {
  const now = 10 * minute
  const entries = [
    ["a", { activeAt: 1 * minute, aliveAt: now }],
    ["b", { activeAt: 5 * minute, aliveAt: now - minute }],
    ["c", { activeAt: 9 * minute, aliveAt: now - 4 * minute }],
  ] as const
  expect(pickActive(entries, now, 3 * minute)).toBe("b")
  expect(pickActive(entries, now, 5 * minute)).toBe("c")
})

test("a tie goes to the larger id, so every session picks the same one", async () => {
  const same = { activeAt: 1, aliveAt: 1 }
  expect(pickActive([["a", same], ["b", same]], 1, minute)).toBe("b")
  expect(pickActive([["b", same], ["a", same]], 1, minute)).toBe("b")
})

test("nobody alive picks nobody", async () => {
  expect(pickActive([["a", { activeAt: 0, aliveAt: 0 }]], 10 * minute, minute)).toBeUndefined()
})

test("toPresence reads only what a session wrote", async () => {
  expect(toPresence({ activeAt: 1, aliveAt: 2 })).toEqual({ activeAt: 1, aliveAt: 2 })
  expect(toPresence({ activeAt: "1", aliveAt: 2 })).toBeUndefined()
  expect(toPresence(null)).toBeUndefined()
})
