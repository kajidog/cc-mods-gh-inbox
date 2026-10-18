import type { InboxNotice } from "gh-inbox"

/** What the options say to read, and how. */
export type Settings = {
  /** null reads every kind. */
  kinds: ReadonlySet<string> | null
  /** Lowercase; null reads every repository. */
  repos: readonly string[] | null
  readSelf: boolean
  format: string
  interrupt: boolean
}

const words = (value: unknown) =>
  String(value ?? "")
    .split(",")
    .map(word => word.trim().toLowerCase())
    .filter(word => word !== "")

export function toSettings(options: Record<string, unknown>): Settings {
  const kinds = words(options.kinds)
  const repos = words(options.repos)
  const format = typeof options.format === "string" && options.format.trim() !== "" ? options.format : "{text}"
  return {
    kinds: kinds.length === 0 ? null : new Set(kinds),
    repos: repos.length === 0 ? null : repos,
    readSelf: options.readSelf === true,
    format,
    interrupt: options.interrupt === true,
  }
}

/** `host/owner/repo` as `owner/repo`. */
const ownerRepo = (repo: string) => repo.split("/").slice(-2).join("/")

/** A word names the repository by `owner/repo`, `host/owner/repo` or its alias. */
function isNamed(word: string, notice: InboxNotice) {
  const repo = notice.repo.toLowerCase()
  return word === repo || word === ownerRepo(repo) || (notice.label !== null && word === notice.label.toLowerCase())
}

export function shouldRead(settings: Settings, notice: InboxNotice) {
  if (notice.isSelf && !settings.readSelf) return false
  if (settings.kinds !== null && !settings.kinds.has(notice.event.kind)) return false
  if (settings.repos !== null && !settings.repos.some(word => isNamed(word, notice))) return false
  return true
}

/** The text read for a notice, its placeholders filled. */
export function speechOf(format: string, notice: InboxNotice) {
  const prefix = notice.label === null ? "" : `[${notice.label}] `
  const body = notice.text.startsWith(prefix) ? notice.text.slice(prefix.length) : notice.text
  const values: Record<string, string> = {
    text: notice.text,
    body,
    label: notice.label ?? "",
    repo: ownerRepo(notice.repo),
    kind: notice.event.kind,
    author: notice.event.author ?? "",
  }
  return format.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
}

/** What to have tts say for a notice as it shows; undefined says nothing. */
export function speechFor(settings: Settings, notice: InboxNotice) {
  if (!shouldRead(settings, notice)) return undefined
  return { text: speechOf(settings.format, notice), interrupt: settings.interrupt }
}
