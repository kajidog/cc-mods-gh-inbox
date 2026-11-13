# gh-inbox

English | [日本語](README.ja.md)

A Claude Code mod.
It shows GitHub events on the checked-out branch's pull request, on pull requests you choose to watch and on repositories you register inside Claude Code, and lets you hand the ones you pick to Claude. Above the prompt, it shows where the pull requests you opened, and those you are asked to review, stand.

`/inbox pr` lists pull requests, and shows one to read, its reviews and comments a card each; what to hand to Claude, and what to do to it, each have a screen of their own ([Pull requests](#pull-requests-inbox-pr)).

It writes to GitHub only to merge, close or draft a pull request, or to approve one or withdraw your approval, and only once you confirm it in a pane ([Merging, closing and drafts](#merging-closing-and-drafts), [Approving](#approving)). Posting comments, labelling and the like are out of its scope.

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
- **Repository events are not real time.** They come from GitHub's Events API, which GitHub says can take from 30 seconds to 6 hours. Only the last 90 days and 300 events are kept. To follow a pull request without that delay, watch it ([Watching a pull request](#watching-a-pull-request)).

## Pull requests (`/inbox pr`)

Everything done to a pull request goes through `/inbox pr`: the list, one pull request shown, and what to do to it.

```
/inbox pr                          # the list of pull requests
/inbox pr 12                       # #12 of this repository: where it stands, what to hand to Claude, what to do to it
/inbox pr owner/repo#12            # or the pull request's URL
/inbox pr show                     # this branch's pull request (pick works too)
/inbox pr merge                    # merge this branch's pull request, once you confirm it in a pane
/inbox pr 12 merge squash          # #12, squashed
/inbox pr 12 close                 # close it without merging; draft, approve and unapprove go the same way
/inbox pr 12 watch                 # notify it as the branch's pull request is; unwatch stops it
/inbox clear                       # detach what is attached
```

With no pull request named, an action is done to this branch's. The pull request and the action may come in either order (`/inbox pr merge 12` too).

### The list

`/inbox pr` opens a pane of pull requests, a group each, each one once, in the first group it falls in:

- this branch's,
- yours and those you are asked to review (as the band above the prompt shows them),
- those watched,
- those `/inbox log` keeps notices of, the newest 10 (an issue's notices, and those on no pull request, left out),
- the open ones of this repository and those in registered repositories you are involved in (including those you are asked to review or have reviewed).

Each row tells its repository's short name and number, where it stands as the band above the prompt tells it, its title, and for those with notices how many and how long ago the newest came. Press one (the first nine also by their digit) to show it; `/inbox pr 12` shows one the list does not hold.

### One pull request

`/inbox pr 12` (or a row pressed) shows the pull request on a screen to read: nothing on it changes the pull request or what goes with your next prompt, so a key pressed by mistake does no harm. It shows, a card each:

- at the top, its number (a link to it on GitHub) and title, its repository, who opened it, whether it is a draft, merged, closed or watched, and where it stands with the reviewers named, each part in its mark's color (`✗` red, `◐` yellow, `○` blue, `●` and `✓` green); the card's border is colored by the most pressing part (purple once merged, grey closed or a draft),
- under a rule each, the CI of its head commit (**Details** unfolds what failed and how to read its log), its description, and its reviews and comments, newest first,
- each review with who gave it, what it says (approved in green, changes requested in red) and how long ago (a link to it), what was written drawn as Markdown, and its threads of line comments in it, each with its file and line, open (yellow) or resolved (grey). A long body shows its first lines, a thread its first comment: **▸ N more lines / replies** unfolds the rest.

Two buttons go to the screens that do something, and **Back** (`b`) comes back:

- **Hand to Claude…** (`c`): the description, CI, reviews and comments to choose from, as below.
- **Actions…** (`o`): **Merge** (`m`), **Convert to draft** / **Mark ready for review** (`d`), **Approve** / **Withdraw approval** (`v`, not on your own) and **Close PR** (`x`), under "Sent to GitHub": each opens the pane that confirms it ([Merging, closing and drafts](#merging-closing-and-drafts), [Approving](#approving)), and what cannot be done is said on this screen instead. Under "Notices", **Watch** / **Stop watching** (`w`), which switches at once. Once what was confirmed is done, the pane goes back to where the pull request stands, read again.

`r` reads it again, `l` goes back to the list, `q` closes the pane.

On **Hand to Claude…**, press an item's `▸` to unfold all Claude reads of it. Choose some (the first nine also by their digit) and press **Attach** (`a`): they go to Claude with the next prompt you send. Write your request in the prompt as usual.

- The items are fetched from GitHub as the pull request shows. What was never notified, or came while the window was closed, can be chosen too.
- Each review has its threads of line comments listed under it. Choosing a review chooses its threads too; a thread can also be chosen alone. A thread comes with its replies.
- Resolved threads are listed too (marked "resolved"), so Claude can also check how they were addressed.
- While something is attached, the count shows above the prompt, with "Pick again" (which shows that pull request again) and "Detach".
- What is attached goes with one prompt only, never with a slash command.
- A line comment's diff is cut to the last 15 lines up to the line commented on. HTML comments, which GitHub does not show, are left out. Diffs and reviews name the commit they are about, and the preamble names the pull request's head commit now.
- Up to the newest 100 threads and reviews and the newest 30 conversation comments are listed. When there are more, the pane says so.
- The items start with the CI of the pull request's head commit (`✗ CI 1/3 abc1234: CI / test`). Chosen, it hands Claude the commit, each failed workflow, job and step with its link, the command that reads its failed steps' log (`gh run view --job 123 --log-failed -R owner/repo`), what the check reported (up to 10 annotations), and the names of the other checks.
- After the CI comes the pull request's description, what its author wrote of it. One that shows nothing on GitHub (a template's HTML comments alone) is not listed.
- What Claude reads with the prompt is in the language set in `/config`.

### Watching a pull request

Pull requests other than the branch's can be notified the same way as the branch's: each is asked about at every check (every 60 seconds by default) with one GraphQL request, not through the Events API, so its notices come without that API's delay. Watch one with `/inbox pr 12 watch` or **Watch** on its **Actions…** screen; `/inbox pr 12 unwatch` stops it. The list is shared across the machine: every window watches the same ones, and `/inbox pr` lists them.

- Its notices are those of the branch's pull request ([What it notifies](#what-it-notifies)), led by the repository's short name and the number: `[tts#20] reviewer approved.` The short name is a registered repository's alias, else the repository's name.
- On a pull request the window watches for the first time, what is already there is not notified. Removed and added again, it starts over from then in every window.
- While it is the checked-out branch's pull request, it is notified as that, once.
- An event that reaches both a watched pull request and its registered repository is notified once, as the pull request's notice. So is a CI run of its newest commit that failed.
- Once seen merged or closed, that is notified and it is asked about no more; it leaves the list a day later. One merged or closed already cannot be added.
- Up to 20 can be watched.

### Merging, closing and drafts

`/inbox pr [PR] merge`, `close` and `draft` (or the buttons on a pull request's **Actions…** screen) merge a pull request, close it, or switch it between a draft and ready for review. Each reads the pull request afresh and opens a pane that says what would be done; nothing is sent to GitHub until you press its button.

- The pane shows the head commit and where the pull request stands, as the line under the prompt does with the reviewers named, and what to know before going on. Its button has no hotkey and nothing is focused as the pane opens, so neither a key typed for the prompt nor Enter sends it: move to it with Tab and press Enter, or click it. `q` cancels.
- A merge goes only while the head is still the commit the pane showed (`gh pr merge --match-head-commit`): pushed to meanwhile, GitHub refuses it and the pane says why.
- The merge method offered first is the one you used last in the repository (GitHub's own default), among those it allows. The pane switches between them (`1`–`3`), or name one: `merge`, `squash`, `rebase`.
- Never past branch protection (no `--admin`), and the branch is not deleted: `gh pr merge --delete-branch` would check out another branch under Claude.
- What GitHub would not merge now is refused before any pane: a draft, a conflict, a base that has moved on (update the branch first), a state GitHub is still working out. One a required review or check still keeps from merging gets auto-merge instead, where the repository allows it: GitHub merges it once it can. With auto-merge on, a merge turns it off.
- A merge of the branch's or a watched pull request is told by its usual notice; anything else says what was done in a toast. A merge a merge queue took in but has not merged yet is said to be so, not merged.

### Approving

`/inbox pr [PR] approve` approves a pull request, and `unapprove` withdraws your approval (or the button on a pull request's **Actions…** screen). As with a merge, each reads the pull request afresh and opens a pane that says what would be done; nothing is sent to GitHub until you press its button.

- What is approved is the head commit the pane showed: pushed to meanwhile, the approval is still of the commit you saw (depending on the repository's settings, GitHub may count it as an approval of an older commit).
- Your own pull request, and one you have approved already, are refused before any pane; so is withdrawing an approval you have not given.
- An approval is withdrawn by dismissing your review on GitHub, which stays on the pull request's timeline with "Approval withdrawn" as why. Dismissing needs write access to the repository, and on a protected branch a place among those who may dismiss reviews; without it, GitHub refuses and the pane says why.
- What was done shows in a toast.

## Telling Claude about CI

While the branch has an open pull request, each new result of its CI goes to Claude with the next prompt you send. You do not have to pick it.

- Passed: the commit it passed on, and the names of the checks.
- Failed: the commit, each failed workflow, job and step with its link, the command that reads its failed steps' log (`gh run view --job 123 --log-failed -R owner/repo`), and the checks still running or passed.
- Nothing is told while checks still run with none failed. A result is told once in each window: the rest finishing with nothing more failed is no new result; another check failing, or a new commit, is.
- It is what the last check saw (every 60 seconds by default). Just after switching branches, nothing is told until the new branch is checked.
- CI of the branch's pull request attached from `/inbox pr` goes in its place, and counts as told: it is not told again. A newer result than the one attached goes with a later prompt.
- A commit with more than 100 checks is read as passed only when GitHub's rollup of all of them says so.
- To turn it off, set **Tell Claude about CI** in `/config` to `false`.

## The line under the prompt

While the branch has a pull request, the line under the prompt tells where it stands, a mark leading each part, the most pressing first:

```
GitHub: #12  ✗ CI 1/3  ○ awaiting review  ✓ 1 approval | alice “Looks good” 5m ago
```

| Mark | Meaning | Parts |
| --- | --- | --- |
| `✗` | Fails, or waits on the author | conflicts, CI failed (failed/all), change requests, behind its base |
| `◐` | Still runs | CI (done/all) |
| `○` | Waits on someone else | awaiting review (one the base requires, or one asked of someone who has not answered), auto-merge on, blocked by a rule no other part tells |
| `●` | GitHub would merge it now | ready to merge |
| `✓` | Passed | CI, approvals |

- A draft says so after its number (`#12 (draft)`); a merged or closed one says so alone (`#12 (merged)`).
- `/inbox`, a pull request shown by `/inbox pr`, and the panes that confirm a merge or an approval say the same with the reviewers named (what the merge pane says holds a merge back awaits only a review the base requires): `✗ changes requested by bob  ○ awaiting review from carol, @org/core  ✓ approved by alice`. People go by their nicknames (`/inbox nick`), teams after `@`; past three, the rest are counted. A team is named only where the token may read the organization's teams (the `read:org` scope, which `gh auth login` asks for); where GitHub refuses that, it is asked again without them, and teams asked are left out.
- After the bar: the newest comment, review or line comment, cut to 30 characters, and how long ago.
- With no pull request, or after `/inbox tray repos`, how long ago each registered repository's last event happened (`GitHub: r 5m ago | other 2h ago`).

## Pull requests above the prompt

Above the prompt, the band lists the open pull requests you opened, and apart from them those you are asked to review, wherever they are: a row each, with where it stands as the line under the prompt tells it.

```
GitHub: your pull requests
  r#3  ✗ CI 1/2  ✓ 1 approval  Fix the build
  tts#7  ● ready to merge  Read only the summary of long answers
  tts#9  ○ awaiting review  Split the settings
  r#4 (draft)  ◐ CI 0/1  Try another layout
asked to review
  app#15  bob  ✓ CI  Bump deps
  app#12  alice  ◐ CI 1/2  Add search
```

- Your own go the most pressing first: what fails, then what can be merged now, what runs, what waits, what passed; drafts last. Alike, the one updated last first.
- Those asked of you go updated last first, with who opened each. That each awaits your review goes without saying.
- Up to 5 show in each group; a heading says how many there are in all where it shows fewer.
- Each row starts with its repository's short name (a registered repository's alias, else its name) and its number, a link to it on GitHub.
- They are searched for at every check (`is:pr is:open author:@me` and `review-requested:@me`, archived repositories left out), on github.com and on the hosts of the registered repositories, the watched pull requests and the branch's. A host that cannot be searched for now keeps what it showed.
- The branch's pull request is listed too, though the line under the prompt tells it.
- `/inbox pr` lists them too, with the rest.
- Collapse the band with its `[-]`; to turn it off, set **Pull requests above the prompt** to `false` in `/config`.

## Commands

| Command | What it does |
| --- | --- |
| `/inbox` | The pull request watched, where it stands (CI, reviews with who gave or owes them, whether it can be merged, the newest comment) and when it was last checked; then each setting as it is now with how to change it, and the commands |
| `/inbox status` | Where things stand alone, without the settings and commands |
| `/inbox check` | Check now |
| `/inbox log [repository]` | Opens a pane of the notices of every window kept, newest first, 10 a page (`n` older, `p` newer, `q` close). Each shows on its first line the repository's short name in color, who did what in bold and color (a link to it on GitHub) and when; what was said goes under it, indented. A notice that says more than fits gets a `▸`: press it (or the digit of its place on the page, `1`–`9`, `0`) to unfold all of it, line comments with their file and line (kept up to 2,000 characters a notice). With notices of more than one repository, buttons above the list narrow it to one (`r` goes to the next); `/inbox log <repository>` opens it narrowed, by the short name, the name or `owner/repo`. The notices of a pull request together, with where it stands, are in `/inbox pr`. A comment, review or line comment edited or deleted on GitHub since it was told is marked `(…, edited 5m ago)` or `(…, deleted)`, and an edited one unfolds to what it says now (see below). Nothing is added to the transcript |
| `/inbox log text` | Lists the newest 20 in the transcript instead, for Claude to read |
| `/inbox pr` | The list of pull requests: this branch's, yours, those asked of you, watched, with notices, this repository's ([Pull requests](#pull-requests-inbox-pr)) |
| `/inbox pr PR` | Show a pull request (`12`, `owner/repo#12` or its URL) to read: where it stands, its CI, description, reviews and threads and comments, a card each; from there, a screen to choose what to hand to Claude, and one to watch, merge, draft, approve or close it |
| `/inbox pr show` | The same, for this branch's pull request (`pick` works too) |
| `/inbox pr [PR] merge [merge\|squash\|rebase]` | Merge a pull request once you confirm it in a pane; auto-merge while a required review or check is missing ([Merging, closing and drafts](#merging-closing-and-drafts)) |
| `/inbox pr [PR] close` | Close a pull request without merging, once you confirm it in a pane |
| `/inbox pr [PR] draft` | Mark a draft ready for review, or convert a pull request to a draft, once you confirm it in a pane |
| `/inbox pr [PR] approve` | Approve a pull request once you confirm it in a pane ([Approving](#approving)) |
| `/inbox pr [PR] unapprove` | Withdraw your approval once you confirm it in a pane (GitHub keeps it as your review dismissed) |
| `/inbox pr [PR] watch` | Watch a pull request: notify it as the branch's is ([Watching a pull request](#watching-a-pull-request)) |
| `/inbox pr [PR] unwatch` | Stop watching it |
| `/inbox clear` | Detach what is attached |
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
| `source` | `pull`: the branch's pull request / `watch`: a pull request watched with `/inbox pr ... watch` / `repo`: a registered repository |
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
| Pull requests above the prompt | true | Above the prompt, a row each, the open pull requests you opened and those you are asked to review, and where each stands ([Pull requests above the prompt](#pull-requests-above-the-prompt)) |
| Tray | true | A line under the prompt, kept up each check. While the branch has a pull request, where it stands (`GitHub: #12  ✗ CI 1/3  ✓ 2 approvals \| alice “Looks good” 5m ago`); otherwise, or after `/inbox tray repos`, how long ago each registered repository's last event happened (`GitHub: r 5m ago \| other 2h ago`). See [The line under the prompt](#the-line-under-the-prompt) |

<details>
<summary>Load on GitHub</summary>

- Checks run every 60 seconds by default (never more often than every 30).
- Checking one pull request costs one GraphQL request, 1 point (5,000 points an hour are available).
- A branch with no pull request is looked up only every 5 minutes. A merged or closed pull request is not asked about any more.
- Each watched pull request costs one GraphQL request (1 point) a check too, as the branch's does; while it is the branch's, it is asked once. Watching one asks once more as it adds it.
- Each prompt you send reads the branch with `git` alone (GitHub is not asked). Only when it has changed is the new branch checked at once, so a switch shows by the next prompt rather than the next check.
- Each registered repository costs one Events API request (and one Actions API request when `ci-failure` is chosen). They are sent with an `ETag`, so an unchanged repository does not count against the rate limit. It is never asked more often than GitHub's `X-Poll-Interval` (usually 60 seconds).
- Telling Claude about CI asks nothing more: it uses the answer of the usual check. Neither does the line under the prompt: whether it can be merged and whether it is a draft come with the rest of the check.
- A merge asks for the pull request afresh (one GraphQL request) and for the repository's merge settings (one more); a close or a draft asks for the pull request alone; an approval or its withdrawal for the pull request and for your own last review that approves, asks for changes or was dismissed (one more). Pressing the pane's button sends one more, through `gh pr merge`, `gh pr close` or `gh pr ready`; an approval through the REST API (`POST /repos/{owner}/{repo}/pulls/{number}/reviews`), its withdrawal through GraphQL (`dismissPullRequestReview`).
- `/inbox pr` looks up the current repository once with `gh repo view` and searches once per host for the open pull requests of this repository and those in registered repositories you are involved in; with the band above the prompt turned off, it searches for yours and those asked of you too. Those it lists that nothing else tells of (those with notices, those found) are asked for their title and where they stand in one GraphQL request a repository (one point), each once each time the list opens; a title kept for a registered repository's notices or a watched pull request's shows before the answer comes.
- A pull request shown by `/inbox pr 12` costs two GraphQL requests: where it stands (another window's answer within one interval is used instead), and what it holds to hand to Claude, the head commit's CI and its annotations included. `/inbox pr 12` with a bare number looks up the current repository once with `gh repo view`.
- `/inbox log` asks what the comments, reviews and line comments on the page it shows say now, as the page shows: one GraphQL request (one point) a page, each page once each time the log opens. The Events API tells no edit or deletion, so nothing is asked between: edits and deletions show only in the log, never as notices.
- The band above the prompt searches each host once a check for the open pull requests you opened and those you are asked to review (both searches in one GraphQL request, one point however many they find: their checks are asked only how each went). The answer is shared between windows: within one interval, a window uses another's.
- A host that refuses a request naming the teams asked to review is asked again without them, once; from then on that window asks it without them.
- Answers are shared between windows. The commits of a new push (up to 5 per check), pull request titles and failed steps are asked for only when needed.

</details>

## Development and license

See the repository's [README](../../README.md).
