import type { Register } from "claude-code"

import { speechFor, toSettings } from "./filter"

export const register: Register = (on, options) => {
  const settings = toSettings(options)

  // Told once every hook on `inbox.notify` has answered: a notice another mod refused never comes, a rewritten one comes as it shows.
  on("inbox.notified", async ($, e, next) => {
    const speech = speechFor(settings, e)
    // Not awaited: the next notice is told while tts queues this one.
    if (speech !== undefined) void $.tts.speak(speech).catch(() => undefined)

    return next(e)
  })
}
