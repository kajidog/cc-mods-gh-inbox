# cc-mods-gh-inbox

Claude Code の mod です。今開いているブランチの PR と、登録したリポジトリに届いた GitHub のイベントを Claude Code の中に通知し、選んだものを Claude に渡せるようにします。

**GitHub は読むだけで、書き込みはしません。** コメントの投稿、マージ、ラベル付けなどは、この mod の対象外です。

## 通知するもの

| イベント | 例 |
| --- | --- |
| コメント | かじさんがコメントしました。この null チェック不要では |
| レビュー | レビさんが変更を依頼しました。指摘2件 … / 承認しました。 |
| 行へのコメント | レビさんがコメントしました。src/a.ts:12 … |
| コミット | かじさんがコミットしました。fix: … / feat: … (+12 −3) |
| CI の失敗 | CI / testのCIが失敗しました。Run npm test |
| マージ・クローズ | #15 がマージされました。 |

- 初めて見る PR では、すでにあるものは通知しません。
- 自分の操作は、初期設定では通知しません。マージは自分の操作でも通知します。
- 通知は、生きている窓のうち最後に操作した窓にだけ出します。`/inbox log` にはどの窓でも入ります。

## リポジトリを登録する

ブランチの PR とは別に、リポジトリを登録して、選んだ種類のイベントを通知できます。登録はマシン全体で共有し、どの窓からでも同じものを見ます。

```
/inbox repo add kajidog/cc-mods-tts              # 種類を選ぶペインが開きます
/inbox repo add kajidog/cc-mods-tts comment,push  # 種類を指定して登録
/inbox repo alias kajidog/cc-mods-tts tts         # 通知の先頭を [tts] にする
```

| 種類 | 内容 | 例 |
| --- | --- | --- |
| `branch` | ブランチ作成 | [tts] かじさんがブランチを作りました。feat/foo |
| `pr-open` | PR 作成 | [tts] かじさんが PR を作りました。#20 長い回答は要約だけ読む |
| `pr-merge` | PR マージ | [tts] #20 がマージされました。長い回答は要約だけ読む |
| `pr-close` | マージせずにクローズ | [tts] #21 がクローズされました。… |
| `comment` | PR・Issue へのコメント | [tts] レビさんが #20 にコメントしました。この null チェック不要では |
| `review` | レビュー | [tts] レビさんが #20 で変更を依頼しました。… |
| `review-comment` | 行へのコメント | [tts] レビさんが #20 にコメントしました。src/a.ts:12 … |
| `push` | push | [tts] かじさんが main に push しました。fix: … / feat: … (+12 −3) |
| `ci-failure` | CI（GitHub Actions）の失敗 | [tts] CI / test の CI が失敗しました（feat/foo）。Run npm test |

- 種類を省いて登録すると、`pr-open`・`pr-merge`・`comment`・`review`・`ci-failure` で始まります。
- その窓で初めて見るリポジトリでは、すでにあるものは通知しません。
- 今のブランチの PR とリポジトリの両方に同じイベントが届いたときは、1回だけ通知します。今のブランチの CI は PR の通知のほうで出します。
- **リポジトリのイベントはリアルタイムではありません。** GitHub の Events API を使っていて、GitHub の説明では、届くまで30秒から6時間かかることがあります。残るのは直近90日・300件までです。

## インストール

```
/plugin install gh-inbox --marketplace kajidog/cc-mods-gh-inbox
```

## 必要なもの

- [GitHub CLI](https://cli.github.com/)（`gh`）で `gh auth login` を済ませていること。mod はトークンを持たず、`gh` に問い合わせます。

## GitHub への負荷

- 確認は初期設定で60秒ごとです（30秒より短くはできません）。
- PR 1件の確認は GraphQL 1回、1ポイントです（1時間あたり5000ポイントまで使えます）。
- PR がないブランチは5分ごとにだけ探します。マージかクローズされた PR は、それ以上問い合わせません。
- 登録したリポジトリは、1件につき Events API を1回（`ci-failure` を選んでいれば Actions API も1回）問い合わせます。`ETag` を付けるので、変わっていなければ回数制限を使いません。GitHub が返す `X-Poll-Interval`（ふつう60秒）より短い間隔では問い合わせません。
- 答えは窓の間で分け合います。新しい push のコミット（1回の確認で5件まで）、PR のタイトル、失敗したステップは、必要なときだけ追加で問い合わせます。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/inbox` | 見ている PR と最後に確認した時刻 |
| `/inbox check` | すぐに確認する |
| `/inbox log` | このセッションの通知（新しい20件） |
| `/inbox repo` | 登録したリポジトリと、通知する種類の一覧 |
| `/inbox repo add owner/repo [種類,...]` | 登録する（種類を省くと、選ぶペインを開く） |
| `/inbox repo set owner/repo [種類,...]` | 種類を変える（種類を省くと、選ぶペインを開く） |
| `/inbox repo remove owner/repo` | 登録を外す |
| `/inbox repo alias owner/repo [短い名前]` | 通知の先頭に出す名前（省くと消す） |
| `/inbox nick <login> <ニックネーム>` | 表示名を短くする（`/inbox nick <login>` で削除、`/inbox nick` で一覧） |

## 設定（`/config`）

| 項目 | 初期値 | 内容 |
| --- | --- | --- |
| Check interval | 60 | 確認の間隔（秒） |
| Where notices show | toast | `toast`: トースト / `log`: トランスクリプトの行 / `notify`: デスクトップ通知 |
| Repositories checked | 20 | 登録できるリポジトリの数 |
| Notify my own activity | false | 自分の操作も通知する |

## 開発

```sh
npm install
claude --plugin-dir ~/cc-mods-gh-inbox   # 読み込んで起動（変更すると読み込み直されます）
npm run check                            # lint・検証・型チェック・テスト
npm run changeset                        # ユーザー向けの変更メモを追加
```

main に入った変更メモから、リリース用の PR が自動で作られます。

## ライセンス

MIT
