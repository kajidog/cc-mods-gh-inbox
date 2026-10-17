# cc-mods-gh-inbox

Claude Code の mod です。今開いているブランチの PR に届いた GitHub のイベントを Claude Code の中に通知し、選んだものを Claude に渡せるようにします。

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

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/inbox` | 見ている PR と最後に確認した時刻 |
| `/inbox check` | すぐに確認する |
| `/inbox log` | このセッションの通知（新しい20件） |
| `/inbox nick <login> <ニックネーム>` | 表示名を短くする（`/inbox nick <login>` で削除、`/inbox nick` で一覧） |

## 設定（`/config`）

| 項目 | 初期値 | 内容 |
| --- | --- | --- |
| Check interval | 60 | 確認の間隔（秒） |
| Where notices show | toast | `toast`: トースト / `log`: トランスクリプトの行 / `notify`: デスクトップ通知 |
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
