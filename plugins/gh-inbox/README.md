# gh-inbox

English | [日本語](README.ja.md)

A Claude Code mod.
It shows GitHub events on the checked-out branch's pull request, on pull requests you choose to watch and on repositories you register inside Claude Code, and lets you hand the ones you pick to Claude.

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
- `/inbox log` is shared by every window (session): it lists the notices of other windows, closed ones too.
- What came while no window was open is listed by the next window that opens, at its first check, with one line saying how many (they are not shown one by one). That covers what GitHub still returns, within 30 days of the last look.
- To open a notice on GitHub with a click, set **Where notices show** to `row` in `/config`. Each notice then stays in the transcript as a row of its own, drawn as `/inbox log` draws it, and what was done (`commented on #3`) is a link to it. The rows are not sent to Claude, and `--resume` does not bring them back. They need Claude Code 2.1.312 or later; before that, notices are the dim lines of `log`.
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
- **Repository events are not real time.** They come from GitHub's Events API, which GitHub says can take from 30 seconds to 6 hours. Only the last 90 days and 300 events are kept. To follow a pull request without that delay, watch it ([Watching pull requests](#watching-pull-requests)).

## Watching pull requests

Pull requests other than the branch's can be notified the same way as the branch's: each is asked about at every check (every 60 seconds by default) with one GraphQL request, not through the Events API, so its notices come without that API's delay. You choose which ones. The list is shared across the machine: every window watches the same ones.

```
/inbox watch add                  # opens a pane to choose from
/inbox watch add 12               # #12 of this repository
/inbox watch add owner/repo#12    # or the pull request's URL
/inbox watch remove owner/repo#12 # stop watching it
/inbox watch                      # the pull requests watched, and where each stands
```

- Its notices are those of the branch's pull request ([What it notifies](#what-it-notifies)), led by the repository's short name and the number: `[tts#20] reviewer approved.` The short name is a registered repository's alias, else the repository's name.
- The pane lists the open pull requests of this repository and those in registered repositories you are involved in (as `/inbox pick` does), then the ones watched. Pressing one starts or stops watching it, saved at once.
- On a pull request the window watches for the first time, what is already there is not notified. Removed and added again, it starts over from then in every window.
- While it is the checked-out branch's pull request, it is notified as that, once.
- An event that reaches both a watched pull request and its registered repository is notified once, as the pull request's notice. So is a CI run of its newest commit that failed.
- Once seen merged or closed, that is notified and it is asked about no more; it leaves the list a day later. One merged or closed already cannot be added.
- Up to 20 can be watched.

## Handing reviews to Claude

`/inbox pick` lists the pull request's reviews and comments in a pane. Press an item's `▸` to unfold all it says. Choose some and press "Attach": they go to Claude with the next prompt you send. Write your request in the prompt as usual.

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
- The list starts with the CI of the pull request's head commit (`CI ✗ 1/3 abc1234: CI / test`). Chosen, it hands Claude the commit, each failed workflow, job and step with its link, the command that reads its failed steps' log (`gh run view --job 123 --log-failed -R owner/repo`), what the check reported (up to 10 annotations), and the names of the other checks.
- What Claude reads with the prompt is in the language set in `/config`.

## Telling Claude about CI

While the branch has an open pull request, each new result of its CI goes to Claude with the next prompt you send. You do not have to pick it.

- Passed: the commit it passed on, and the names of the checks.
- Failed: the commit, each failed workflow, job and step with its link, the command that reads its failed steps' log (`gh run view --job 123 --log-failed -R owner/repo`), and the checks still running or passed.
- Nothing is told while checks still run with none failed. A result is told once in each window: the rest finishing with nothing more failed is no new result; another check failing, or a new commit, is.
- It is what the last check saw (every 60 seconds by default). Just after switching branches, nothing is told until the new branch is checked.
- CI of the branch's pull request picked with `/inbox pick` goes in its place, and counts as told: it is not told again. A newer result than the one picked goes with a later prompt.
- A commit with more than 100 checks is read as passed only when GitHub's rollup of all of them says so.
- To turn it off, set **Tell Claude about CI** in `/config` to `false`.

## Commands

| Command | What it does |
| --- | --- |
| `/inbox` | The pull request watched, where it stands (CI, approvals, conflicts, the newest comment) and when it was last checked |
| `/inbox check` | Check now |
| `/inbox log [repository]` | Opens a pane of the notices of every window kept, newest first, 10 a page (`n` older, `p` newer, `q` close). Each shows on its first line the repository's short name in color, who did what in bold and color (a link to it on GitHub) and when; what was said goes under it, indented. A notice that says more than fits gets a `▸`: press it (or the digit of its place on the page, `1`–`9`, `0`) to unfold all of it, line comments with their file and line (kept up to 2,000 characters a notice). With notices of more than one repository, buttons above the list narrow it to one (`r` goes to the next); `/inbox log <repository>` opens it narrowed, by the short name, the name or `owner/repo`. A comment, review or line comment edited or deleted on GitHub since it was told is marked `(…, edited 5m ago)` or `(…, deleted)`, and an edited one unfolds to what it says now (see below). Nothing is added to the transcript |
| `/inbox log text` | Lists the newest 20 in the transcript instead, for Claude to read |
| `/inbox pick [PR]` | Choose threads, reviews and comments to hand to Claude |
| `/inbox clear` | Detach what is attached |
| `/inbox watch` | The pull requests watched, where each stands (CI, approvals, conflicts, the newest comment) and when it was last checked |
| `/inbox watch add [PR]` | Watch a pull request: `12`, `owner/repo#12` or its URL (without one, opens a pane to choose) |
| `/inbox watch remove PR` | Stop watching it |
| `/inbox repo` | The registered repositories, the kinds they notify, and when each was last checked and last had an event |
| `/inbox repo add owner/repo [kind,...]` | Register (without kinds, opens a pane to choose them) |
| `/inbox repo set owner/repo [kind,...]` | Change the kinds (without kinds, opens the pane) |
| `/inbox repo remove owner/repo` | Unregister |
| `/inbox repo alias owner/repo [short name]` | The name notices start with (without one, clears it) |
| `/inbox nick <login> <nickname>` | A shorter name to show (`/inbox nick <login>` removes it, `/inbox nick` lists them) |
| `/inbox tray [pull\|repos]` | What the line under the prompt shows: the branch's pull request or every registered repository (without one, switches between them) |

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
| `source` | `pull`: the branch's pull request / `watch`: a pull request watched with `/inbox watch` / `repo`: a registered repository |
| `repo` | `host/owner/repo` |
| `label` | The registered repository's alias (its name when it has none), with the number for a watched pull request (`tts#20`). `null` for the branch's pull request |
| `isSelf` | Whether the account `gh` is logged in as did it |
| `text` | The line shown, in the language set in `/config` |

- Called only in the window that shows notices (the one used last), whatever the channel (toast, log, row, notify).
- A notice stopped with `{ deny }` does not show and does not reach `inbox.notified`, but `/inbox log` still lists it.
- When many come at once and are folded into an "N more updates" line, `inbox.notified` is still called once for each.
- [gh-inbox-tts](../gh-inbox-tts/README.md), which reads notices aloud, is built on this.
- The types are `Inbox` and `InboxNotice` in `types/index.d.ts`. With `gh-inbox` in the `dependencies` of `plugin.json`, `$.inbox` is typed.

## Settings (`/config`)

| Setting | Default | What it does |
| --- | --- | --- |
| Check interval | 60 | Seconds between checks |
| Where notices show | toast | `toast`: a toast / `log`: a line in the transcript / `row`: a row in the transcript whose link opens the notice on GitHub (Claude Code 2.1.312 or later) / `notify`: a desktop notification |
| Repositories checked | 20 | How many repositories can be registered |
| Language | en | `en`: English / `ja`: Japanese. For notices, commands, panes, and what is handed to Claude |
| Notify my own activity | false | Also notify your own activity |
| Tell Claude about CI | true | Tell Claude each new result of the branch's pull request's CI with the next prompt you send ([Telling Claude about CI](#telling-claude-about-ci)) |
| Tray | true | A line under the prompt, kept up each check. While the branch has a pull request, where it stands (`GitHub: #12 \| CI ✗ 1/3 \| 2 approvals \| conflicts \| alice: Looks good 5m ago`); otherwise, or after `/inbox tray repos`, how long ago each registered repository's last event happened (`GitHub: r 5m ago \| other 2h ago`) |

<details>
<summary>Load on GitHub</summary>

- Checks run every 60 seconds by default (never more often than every 30).
- Checking one pull request costs one GraphQL request, 1 point (5,000 points an hour are available).
- A branch with no pull request is looked up only every 5 minutes. A merged or closed pull request is not asked about any more.
- Each watched pull request costs one GraphQL request (1 point) a check too, as the branch's does; while it is the branch's, it is asked once. `/inbox watch add owner/repo#12` asks once more as it adds it; the pane of `/inbox watch` looks up the current repository once with `gh repo view` and searches once per host, as `/inbox pick` does.
- Each prompt you send reads the branch with `git` alone (GitHub is not asked). Only when it has changed is the new branch checked at once, so a switch shows by the next prompt rather than the next check.
- Each registered repository costs one Events API request (and one Actions API request when `ci-failure` is chosen). They are sent with an `ETag`, so an unchanged repository does not count against the rate limit. It is never asked more often than GitHub's `X-Poll-Interval` (usually 60 seconds).
- Telling Claude about CI asks nothing more: it uses the answer of the usual check.
- `/inbox pick` sends one GraphQL request as it opens, the head commit's CI and its annotations included. The list of pull requests and `/inbox pick 12` look up the current repository once with `gh repo view`; the list also searches once per host.
- `/inbox log` asks what the comments, reviews and line comments on the page it shows say now, as the page shows: one GraphQL request (one point) a page, each page once each time the log opens. The Events API tells no edit or deletion, so nothing is asked between: edits and deletions show only in the log, never as notices.
- Answers are shared between windows. The commits of a new push (up to 5 per check), pull request titles and failed steps are asked for only when needed.

</details>

## Development and license

See the repository's [README](../../README.md).
