# gh-inbox

English | [日本語](README.ja.md)

A Claude Code mod.
It shows GitHub events on the checked-out branch's pull request and on repositories you register inside Claude Code, and lets you hand the ones you pick to Claude.

Posting comments, merging, labelling and the like are out of its scope: it never writes to GitHub.

## What it notifies

| Event | Example |
| --- | --- |
| Comment | alice commented: Isn't this null check unneeded? |
| Review | reviewer requested changes (2 comments): … / reviewer approved. |
| Line comment | reviewer commented: src/a.ts:12 … |
| Commit | alice committed: fix: … / feat: … (+12 −3) |
| CI failure | CI failed: CI / test: Run npm test |
| Merge / close | #15 was merged. |

- On a pull request seen for the first time, what is already there is not notified.
- Your own activity is not notified by default. A merge is notified even when it is yours.
- Notices show only in the window used last among those alive. `/inbox log` lists them in every window.
- Notices, commands and panes are in English by default; set **Language** to `ja` in `/config` for Japanese (see [Settings](#settings-config)).

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`), logged in with `gh auth login`. The mod holds no token: it asks `gh`.

## Install

```
/plugin install gh-inbox --marketplace kajidog/cc-mods-gh-inbox
```

## Registering repositories

Apart from the branch's pull request, you can register repositories and be notified of the kinds of events you choose. The registrations are shared across the machine: every window sees the same ones.

```
/inbox repo add kajidog/cc-mods-tts              # opens a pane to choose the kinds
/inbox repo add kajidog/cc-mods-tts comment,push  # register with these kinds
/inbox repo alias kajidog/cc-mods-tts tts         # start its notices with [tts]
```

| Kind | What | Example |
| --- | --- | --- |
| `branch` | A branch created | [tts] alice created a branch: feat/foo |
| `pr-open` | A PR opened | [tts] alice opened a PR: #20 Read only the summary of long answers |
| `pr-merge` | A PR merged | [tts] #20 was merged: Read only the summary of long answers |
| `pr-close` | A PR closed without merging | [tts] #21 was closed: … |
| `comment` | A comment on a PR or an issue | [tts] reviewer commented on #20: Isn't this null check unneeded? |
| `review` | A review | [tts] reviewer requested changes on #20: … |
| `review-comment` | A line comment | [tts] reviewer commented on #20: src/a.ts:12 … |
| `push` | A push | [tts] alice pushed to main: fix: … / feat: … (+12 −3) |
| `ci-failure` | A CI (GitHub Actions) failure | [tts] CI failed on feat/foo: CI / test: Run npm test |

- Registered without kinds, a repository starts with `pr-open`, `pr-merge`, `comment`, `review` and `ci-failure`.
- On a repository the window sees for the first time, what is already there is not notified.
- An event that reaches both the branch's pull request and a registered repository is notified once. CI on the newest commit of the branch's pull request is notified as that pull request's notice.
- **Repository events are not real time.** They come from GitHub's Events API, which GitHub says can take from 30 seconds to 6 hours. Only the last 90 days and 300 events are kept.

## Handing reviews to Claude

`/inbox pick` lists the pull request's reviews and comments in a pane. Choose some and press "Attach": they go to Claude with the next prompt you send. Write your request in the prompt as usual.

```
/inbox pick               # the branch's pull request (with none, a list of pull requests to choose from)
/inbox pick 12            # #12 of this repository
/inbox pick owner/repo#12 # a pull request of another repository
/inbox clear              # detach what is attached
```

- The list is fetched from GitHub as the pane opens. What was never notified, or came while the window was closed, can be chosen too.
- Each review has its threads of line comments listed under it. Choosing a review chooses its threads too; a thread can also be chosen alone. A thread comes with its replies.
- Resolved threads are listed too (marked "resolved"), so Claude can also check how they were addressed.
- The list of pull requests holds the open ones of this repository, and those in registered repositories you are involved in (including those you are asked to review or have reviewed).
- While something is attached, the count shows above the prompt, with "Pick again" and "Detach".
- What is attached goes with one prompt only, never with a slash command.
- A line comment's diff is cut to the last 15 lines up to the line commented on. HTML comments, which GitHub does not show, are left out. Diffs and reviews name the commit they are about, and the preamble names the pull request's head commit now.
- Up to the newest 100 threads and reviews and the newest 30 conversation comments are listed. When there are more, the pane says so.
- What Claude reads with the prompt is in the language set in `/config`.

## Commands

| Command | What it does |
| --- | --- |
| `/inbox` | The pull request watched and when it was last checked |
| `/inbox check` | Check now |
| `/inbox log` | This session's notices (the newest 20) |
| `/inbox pick [PR]` | Choose threads, reviews and comments to hand to Claude |
| `/inbox clear` | Detach what is attached |
| `/inbox repo` | The registered repositories and the kinds they notify |
| `/inbox repo add owner/repo [kind,...]` | Register (without kinds, opens a pane to choose them) |
| `/inbox repo set owner/repo [kind,...]` | Change the kinds (without kinds, opens the pane) |
| `/inbox repo remove owner/repo` | Unregister |
| `/inbox repo alias owner/repo [short name]` | The name notices start with (without one, clears it) |
| `/inbox nick <login> <nickname>` | A shorter name to show (`/inbox nick <login>` removes it, `/inbox nick` lists them) |

## Using it from another mod

Another mod can hook two events.

- `inbox.notify`: before a notice shows. It can rewrite the text or stop the notice.
- `inbox.notified`: once every hook on `inbox.notify` has answered. The notices nobody stopped come as they show. Use this one to act on a notice that showed, such as reading it aloud or sending it elsewhere (a mod acting midway through `inbox.notify` may see another mod stop or change the notice afterwards).

```ts
on("inbox.notify", async ($, e, next) => {
  if (e.isSelf) return { deny: "not my own activity" } // do not show it
  return next({ ...e, text: `★ ${e.text}` })            // show it rewritten
})

on("inbox.notified", async ($, e, next) => {
  if (e.event.kind === "ci") void doSomething(e.text) // act on the notice that showed
  return next(e)
})
```

| Field | What |
| --- | --- |
| `event` | The event the notice came from: `kind` (`comment` `review` `commit` `ci` `merge` `close` `branch` `open` `push`), `pull`, `author`, `url`, the bodies in `items`, and so on |
| `source` | `pull`: the branch's pull request / `repo`: a registered repository |
| `repo` | `host/owner/repo` |
| `label` | The registered repository's alias (its name when it has none). `null` for the branch's pull request |
| `isSelf` | Whether the account `gh` is logged in as did it |
| `text` | The line shown, in the language set in `/config` |

- Called only in the window that shows notices (the one used last), whatever the channel (toast, log, notify).
- A notice stopped with `{ deny }` does not show and does not reach `inbox.notified`, but `/inbox log` still lists it.
- When many come at once and are folded into an "N more updates" line, `inbox.notified` is still called once for each.
- [gh-inbox-tts](../gh-inbox-tts/README.md), which reads notices aloud, is built on this.
- The types are `Inbox` and `InboxNotice` in `types/index.d.ts`. With `gh-inbox` in the `dependencies` of `plugin.json`, `$.inbox` is typed.

## Settings (`/config`)

| Setting | Default | What it does |
| --- | --- | --- |
| Check interval | 60 | Seconds between checks |
| Where notices show | toast | `toast`: a toast / `log`: a line in the transcript / `notify`: a desktop notification |
| Repositories checked | 20 | How many repositories can be registered |
| Language | en | `en`: English / `ja`: Japanese. For notices, commands, panes, and what is handed to Claude |
| Notify my own activity | false | Also notify your own activity |

<details>
<summary>Load on GitHub</summary>

- Checks run every 60 seconds by default (never more often than every 30).
- Checking one pull request costs one GraphQL request, 1 point (5,000 points an hour are available).
- A branch with no pull request is looked up only every 5 minutes. A merged or closed pull request is not asked about any more.
- Each registered repository costs one Events API request (and one Actions API request when `ci-failure` is chosen). They are sent with an `ETag`, so an unchanged repository does not count against the rate limit. It is never asked more often than GitHub's `X-Poll-Interval` (usually 60 seconds).
- `/inbox pick` sends one GraphQL request as it opens. The list of pull requests and `/inbox pick 12` look up the current repository once with `gh repo view`; the list also searches once per host.
- Answers are shared between windows. The commits of a new push (up to 5 per check), pull request titles and failed steps are asked for only when needed.

</details>

## Development and license

See the repository's [README](../../README.md).
