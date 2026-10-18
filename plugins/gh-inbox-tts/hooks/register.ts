import type { Register } from "claude-code"

import { speechFor, toSettings } from "./filter"

export const register: Register = (on, options) => {
  const settings = toSettings(options)

  // Read once the hooks beneath let the notice through: one another mod refused is not read, a rewritten one is read as rewritten.
  on("inbox.notify", async ($, e, next) => {
    const result = await next(e)
    const speech = speechFor(settings, result)
    // Not awaited: the notice shows while tts queues it.
    if (speech !== undefined) void $.tts.speak(speech).catch(() => undefined)

    return result
  })
}
