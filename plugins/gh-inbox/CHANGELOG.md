# gh-inbox

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
