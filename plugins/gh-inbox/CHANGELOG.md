# gh-inbox

## 0.16.0

### Minor Changes

- 17a89e0: The band above the prompt lists, a row each, the open pull requests you opened (the most pressing first: what fails, what can be merged now, what runs, what waits; drafts last) and, under a heading of their own, those you are asked to review (updated last first, with who opened each), wherever they are: each with where it stands as the line under the prompt tells it, up to 5 a group, each linked from its number. They are searched for at every check on github.com and on the hosts of the registered repositories and watched pull requests: both searches in one GraphQL request a host, one point, shared between windows. Turn it off with **Pull requests above the prompt** in `/config`.
  
  入力欄の上に、自分が出している開いた PR と、レビューを頼まれた PR を分けて、どのリポジトリのものもまとめて1件1行で出すようにしました。状態はプロンプトの下の行と同じ書き方で、自分の PR は急ぐもの（失敗、今マージできる、実行中、待ち。下書きは最後）から、レビュー依頼は更新が新しい順に作った人を添えて、それぞれ5件まで並べ、番号は GitHub へのリンクです。確認のたびに、github.com と、登録したリポジトリ・通知している PR のホストで探します（ホストごとに2つの検索をまとめて GraphQL 1回・1ポイント、答えは窓の間で分け合います）。出さないときは `/config` の **Pull requests above the prompt** を `false` にします。
- 17a89e0: `/inbox`, `/inbox watch`, the panes of `/inbox merge` and `/inbox approve`, and the headings of `/inbox log` narrowed to one repository name who approved, who asked for changes and whose review is still asked for (`✓ approved by alice`, `○ awaiting review from carol, @org/core`); the line under the prompt still counts them. "Awaiting review" now also shows while someone asked to review has not answered, not only while the base requires a review. Narrowed to one repository, each heading of `/inbox log` also says where its pull request stands now, merged or closed included; where the heading's row cannot hold it, a `▸ status` button unfolds it under the heading. A token that may not read the organization's teams is asked again without them. `/inbox pick` lists the pull request's description after its CI, to hand to Claude with the rest.
  
  `/inbox`・`/inbox watch`・`/inbox merge` と `/inbox approve` のペイン・1つのリポジトリに絞り込んだ `/inbox log` の見出しで、承認した人・変更を依頼した人・レビューを待っている人の名前を出すようにしました（`✓ 承認（aliceさん）`、`○ レビュー待ち（carolさん、@org/core）`）。プロンプトの下の行は件数のままです。「レビュー待ち」は、base がレビューを求めているときに加えて、頼んだ人がまだレビューしていないあいだも出します。絞り込んだ `/inbox log` の見出しには、PR の今の状態（マージ済み・クローズ済みも）も出します。見出しの行に収まらないときは、`▸ 状態` ボタンで見出しの下に開きます。組織のチームを読めないトークンでは、チームを外して問い合わせ直します。`/inbox pick` では、CI の次に PR の説明文を出し、ほかの項目と一緒に Claude に渡せるようにしました。

## 0.15.0

### Minor Changes

- 22a3df5: `/inbox approve` approves a pull request and `/inbox unapprove` withdraws your approval, each once you confirm it in the pane, as `/inbox merge` does. The approval is of the head commit the pane showed. Your own pull request, one you have approved already, and withdrawing an approval you have not given are refused before any pane. Withdrawing dismisses your approving review, which GitHub keeps on the pull request with why.
  
  `/inbox approve` で PR を承認し、`/inbox unapprove` で自分の承認を取り消せるようにしました。`/inbox merge` と同じく、ペインで確かめてから行います。承認するのは、ペインに出した先頭のコミットです。自分の PR、もう承認している PR、承認していない PR の取り消しは、ペインを開く前に断ります。取り消しは自分の承認レビューの却下（dismiss）として行い、GitHub の PR に理由と一緒に残ります。
- 22a3df5: Narrowed to one repository, the `/inbox log` pane puts its notices together by pull request (or issue), each under a heading with its number, a link to it on GitHub, and its title: the one with the newest notice first, each one's newest first. What is on no pull request (pushes, branches, CI) goes under a heading of its own, and the rows leave out the repository's short name. A title not known already is asked for once each time the log opens, one GraphQL request a page.
  
  `/inbox log` のペインを1つのリポジトリに絞り込むと、通知を PR（Issue）ごとにまとめ、番号（GitHub へのリンク）とタイトルの見出しの下に並べるようにしました。最新の通知が新しい PR から順に、PR の中も新しい順です。push・ブランチ・CI など PR に付かないものは1つの見出しにまとめ、各行の先頭のリポジトリの短い名前は出しません。まだ分からないタイトルは、ログを開くたびに1回、ページごとに GraphQL 1回で問い合わせます。

## 0.14.0

### Minor Changes

- e2b38e8: `/inbox merge`, `/inbox close` and `/inbox draft` merge a pull request, close it, or switch it between a draft and ready for review. Each reads the pull request afresh and opens a pane that shows the head commit and where it stands; nothing is sent to GitHub until you press the pane's button, which has no hotkey. A merge goes only at the head commit the pane showed (`--match-head-commit`), with the repository's allowed method you used last (`merge`, `squash` or `rebase` to choose another), never past branch protection and without deleting the branch. What GitHub would not merge now (a draft, a conflict, a base moved on) is refused before any pane; one a required review or check still holds back gets auto-merge where the repository allows it.
  
  `/inbox merge`・`/inbox close`・`/inbox draft` で、PR のマージ、クローズ、下書きとレビュー待ちの切り替えができるようにしました。どれも PR をその場で取り直し、先頭のコミットと状態をペインに出します。ペインのボタン（ホットキーなし）を押すまでは GitHub に何も送りません。マージは、ペインに出した先頭のコミットのままのときだけ行い（`--match-head-commit`）、方式はリポジトリで使えるもののうち前回使ったものです（`merge`・`squash`・`rebase` で指定もできます）。ブランチ保護は越えず、ブランチも消しません。下書き・コンフリクト・base が先に進んでいるなど今マージできないものはペインを開く前に断り、必須のレビューやチェックが足りないだけなら、リポジトリが許していれば自動マージを設定します。
- e2b38e8: The line under the prompt leads each part of where the pull request stands with a mark, the most pressing first: `✗` fails or waits on the author (conflicts, failed CI, change requests, a base moved on), `◐` still runs, `○` waits on someone else (a review, auto-merge, a rule), `●` GitHub would merge it now, `✓` passed. A draft says so after its number. The newest comment follows a bar, cut shorter. `/inbox`, `/inbox watch` and the CI item of `/inbox pick` read the same way. GitHub is asked nothing more for it.
  
  プロンプトの下の行を見直し、PR の状態の項目ごとに先頭に記号を付けて、急ぐものから並べるようにしました。`✗` は失敗・作者の対応が必要なもの（コンフリクト、CI の失敗、変更依頼、base より古い）、`◐` は実行中、`○` はほかの人や条件待ち（レビュー、自動マージ、ルール）、`●` は今マージできる、`✓` は通ったものです。下書きは番号のあとに出します。最新のコメントは `|` のあとに短くして出します。`/inbox`・`/inbox watch`・`/inbox pick` の CI の項目も同じ書き方です。GitHub への問い合わせは増えません。

## 0.13.0

### Minor Changes

- cb71d0e: **Where notices show** in `/config` has a new choice, `row`: each notice stays in the transcript as a row of its own, drawn as `/inbox log` draws it, and what was done (`commented on #3`) is a link that opens it on GitHub. The rows are not sent to Claude. They need Claude Code 2.1.312 or later; before that, notices are the dim lines of `log`. With `log`, the line counting notices not shown one by one no longer says `GitHub:` twice.
  
  `/config` の **Where notices show** に `row` を足しました。通知が1件ずつ行として会話の中に残り（`/inbox log` と同じ2段表示）、「#3 にコメントしました」のような何をしたかの部分を押すと GitHub で開きます。行は Claude には送られません。Claude Code 2.1.312 以降で使えます（それより前では `log` と同じ薄い行で出します）。あわせて、`log` で「ほか N 件」の行の頭に `GitHub:` が2回付いていたのを直しました。

## 0.12.0

### Minor Changes

- d88d093: Pull requests other than the branch's can be watched with `/inbox watch`: each is asked about at every check with one GraphQL request, as the branch's is, so its notices come without the Events API's delay. `/inbox watch add` opens a pane to choose them (this repository's open pull requests, and those in registered repositories you are involved in); `/inbox watch add owner/repo#12` names one. Their notices start with the repository's short name and the number, as `[tts#12]`. What a registered repository tells of them too is told once. One seen merged or closed is asked about no more and leaves the list a day later.
  
  今のブランチ以外の PR も `/inbox watch` で選んで、今のブランチの PR と同じ経路（確認のたびに GraphQL で1回問い合わせる）で通知できるようにしました。ブランチを開いていない PR でも、Events API の遅れなく通知が届きます。`/inbox watch add` で選ぶペイン（このリポジトリで開いている PR と、登録したリポジトリで自分が関わっている PR）が開き、`/inbox watch add owner/repo#12` で直接指定もできます。通知の先頭には `[tts#12]` のようにリポジトリの短い名前と番号が付きます。登録したリポジトリにも同じイベントが届いたときは1回だけ通知します。マージ・クローズを通知したあとは問い合わせず、1日たつと一覧から外れます。

## 0.11.0

### Minor Changes

- f7d9fc6: While the branch has an open pull request, each new result of its CI goes to Claude with the next prompt you send: the commit it passed on, or each failed workflow, job and step with its link and the `gh run view --job … --log-failed` command that reads its log. Nothing is told while checks still run with none failed, and a result is told once. `/inbox pick` lists the head commit's CI first, to hand over with its annotations too. **Tell Claude about CI** in `/config` turns it off. No more requests are sent to GitHub for it.
  
  今のブランチに開いている PR があるあいだは、その CI に新しい結果が出るたびに、次に送るプロンプトと一緒に Claude に渡すようにしました。成功ならどのコミットで通ったか、失敗ならワークフロー・ジョブ・ステップとそのリンク、ログを読む `gh run view --job … --log-failed` のコマンドを渡します。まだ実行中で失敗もないあいだは渡さず、同じ結果は1回だけ渡します。`/inbox pick` の一覧の先頭にも先頭コミットの CI が出て、アノテーションも含めて選んで渡せます。`/config` の **Tell Claude about CI** で止められます。GitHub への問い合わせは増えません。

## 0.10.0

### Minor Changes

- f041d82: The `/inbox log` pane marks a comment, review or line comment edited or deleted on GitHub since it was told (`(1h ago, edited 5m ago)`, `(1h ago, deleted)`), and an edited one unfolds to what it says now. It asks for the page it shows only, one GraphQL request a page, nothing between; no notice is shown for an edit.
  
  `/inbox log` のペインで、通知したあとに GitHub で編集・削除されたコメント・レビュー・行コメントに `（1時間前、編集済み・5分前）` `（1時間前、削除済み）` と付け、編集されたものは `▸` で今の本文を開けるようにしました。問い合わせるのは表示したページの分だけ（1ページにつき GraphQL 1回）で、それ以外のときには問い合わせません。編集は通知しません。

## 0.9.0

### Minor Changes

- 8d89706: The `/inbox log` pane narrows to one repository by the buttons above its list (`r` goes to the next), and `/inbox log <repository>` opens it narrowed, by the short name, the name or `owner/repo` (`text` too).
  
  `/inbox log` のペインで、一覧の上のボタン（`r` で次へ）で1つのリポジトリに絞り込めるようにしました。`/inbox log <リポジトリ>`（短い名前・名前・`owner/repo`）で絞り込んだ状態で開けます（`text` でも同じ）。
- 8d89706: The `/inbox pick` pane unfolds an item to all it says (a thread with its diff and replies) by its `▸`, as the log pane does; unfolding does not choose it.
  
  `/inbox pick` のペインでも、項目の `▸` を押すと全文（スレッドなら差分と返信も）を開けるようにしました（ログのペインと同じ。開いても選択はされません）。

### Patch Changes

- 8d89706: The line under the prompt parts its repositories (and what it tells of the pull request) with ` | ` instead of ` · `.
  
  プロンプト下の行の区切りを ` · ` から ` | ` に変えました。

## 0.8.0

### Minor Changes

- e6552c5: `/inbox log` opens a pane of every notice kept, newest first, 10 a page (`n` older, `p` newer, `q` close), so a long log no longer runs down the transcript. `/inbox log text` lists the newest 20 in the transcript as before.
  
  `/inbox log` は保存している通知をすべてペインで開くようにしました（新しい順に10件ずつ。`n` で古い方へ、`p` で新しい方へ、`q` で閉じる）。件数が増えてもトランスクリプトに流れません。これまでどおりトランスクリプトに出したいときは `/inbox log text` を使います（新しい20件）。
- e6552c5: The log keeps what each notice said (up to 2,000 characters, line comments with their file and line), and the `/inbox log` pane unfolds a notice that says more than its line to all of it: press its `▸`, or the digit of its place on the page.
  
  ログに各通知の全文（1件2,000字まで。行コメントはファイルと行も）を保存し、`/inbox log` のペインで1行に収まらない通知を `▸`（またはページ内の位置の数字キー）で開いて全文を見られるようにしました。

### Patch Changes

- e6552c5: `/inbox log` draws who did it and what they did in bold and the `claude` theme color, set apart from what they said.
  
  `/inbox log` で「誰が何をしたか」の部分を太字・`claude` テーマ色で表示し、本文との境目をわかりやすくしました。
- e6552c5: `/inbox log` draws each notice on two lines: the repository's short name, who did what and when first, what was said under it, indented.
  
  `/inbox log` の各通知を、1行目にリポジトリ・名前・操作（といつのことか）、2行目以降に内容を字下げして表示するようにしました。

## 0.7.0

### Minor Changes

- f9a1bb7: The line under the prompt tells where the branch's pull request stands: CI, approvals and change requests, conflicts, and the newest comment. `/inbox tray` switches it to every registered repository and back; `/inbox` tells the same. A branch switched to is followed by the next prompt sent, not the next check.
  
  プロンプトの下の行に、今のブランチの PR の状態（CI、承認・変更依頼の件数、コンフリクト、最新のコメント）を出すようにしました。`/inbox tray` で登録したリポジトリ全体の表示と切り替えられます。`/inbox` にも同じ内容を出します。ブランチを切り替えると、次の確認を待たずに、次にプロンプトを送った時点で追従します。

## 0.6.1

### Patch Changes

- 5804f6a: `/inbox log` draws a push's or commit's changed line counts in color, sign and all: `+15` green, `−10` red.
  
  `/inbox log` で push やコミットの変更行数を記号ごと色付けしました（`+15` は緑、`−10` は赤）。

## 0.6.0

### Minor Changes

- 5b4b308: `/inbox log` draws the repository's short name in color and links only what was done, not the whole line. `/inbox repo` tells how long ago each repository's last event happened, and a tray line under the prompt keeps telling it for every registered repository (turn it off with "GitHub: Tray" in /config).
  
  `/inbox log` でリポジトリの短い名前に色を付け、リンクを行全体から「何をしたか」の部分だけにしました。`/inbox repo` で、リポジトリごとに最後のイベントが何分前かを出します。プロンプトの下のトレイにも常に出します（/config の「GitHub: Tray」で消せます）。

## 0.5.0

### Minor Changes

- fe6e961: `/inbox log` now lists the notices of every window, closed ones too, each line a link to it on GitHub with when it happened beside it. What came while no window was open is listed by the next window at its first check, with one line saying how many.
  
  `/inbox log` が窓（セッション）をまたいで通知を出すようにしました。閉じた窓の通知も見られます。各行は GitHub へのリンクになり、いつのことかを添えます。どの窓も開いていなかったあいだの更新は、次に開いた窓が最初の確認で一覧に入れ、件数を知らせます。

## 0.4.0

### Minor Changes

- 2ebc339: Notices, commands, panes and what is handed to Claude now come in English or Japanese, chosen by the new **Language** setting in `/config`. English is the default: to keep the Japanese lines, set it to `ja`.
  
  通知・コマンド・ペインと Claude に渡す文を、英語と日本語から選べるようにしました（`/config` の **Language**）。初期値は英語です。これまでどおり日本語で出すには `ja` にしてください。

## 0.3.0

### Minor Changes

- 2daf686: 通知を出す前に `$.inbox.notify` を通すようにしました。他の mod が `inbox.notify` をフックすると、通知の前に処理を挟んだり、文を変えたり、通知を止めたりできます。フックが全部答えたあとの通知は `inbox.notified` で受け取れます。

### Patch Changes

- 5ea7c35: リポジトリの中の場所を `plugins/gh-inbox` に移しました。`/plugin install` で入れている場合はそのまま更新できます。`--plugin-dir ~/cc-mods-gh-inbox` で読み込んでいる場合は、`--plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox` に変えてください。

## 0.2.0

### Minor Changes

- 3732043: `/inbox pick` で、PR のレビュー（行コメントのスレッドと返信、解決済みも含む）とコメントを選んで Claude に渡せるようにしました。レビューを選ぶとその行コメントもまとめて選びます。選んだものは次に送るプロンプトと一緒に渡します。今のブランチに PR がなければ、このリポジトリと登録したリポジトリの PR から選びます。`/inbox pick 12` や `owner/repo#12` で PR を指定することもできます。
- 32a237f: リポジトリを登録して、選んだ種類のイベント（ブランチ作成、PR の作成・マージ・クローズ、コメント、レビュー、行へのコメント、push、CI の失敗）を通知できるようにしました。`/inbox repo add owner/repo` で登録し、種類はペインか `/inbox repo set` で選びます。今のブランチの PR と同じイベントは1回だけ通知します。
