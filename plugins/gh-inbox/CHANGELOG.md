# gh-inbox

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
