# gh-inbox

[English](README.md) | 日本語

Claude Code の mod です。  
今開いているブランチの PR と、登録したリポジトリに届いた GitHub のイベントを Claude Code の中に通知し、選んだものを Claude に渡せるようにします。

コメントの投稿、マージ、ラベル付けなどは、この mod の対象外です。

## 通知するもの

| イベント | 例 |
| --- | --- |
| コメント | Aさんがコメントしました。この null チェック不要では |
| レビュー | レビューさんが変更を依頼しました。指摘2件 … / 承認しました。 |
| 行へのコメント | レビューさんがコメントしました。src/a.ts:12 … |
| コミット | Aさんがコミットしました。fix: … / feat: … (+12 −3) |
| CI の失敗 | CI / testのCIが失敗しました。Run npm test |
| マージ・クローズ | #15 がマージされました。 |

- 初めて見る PR では、すでにあるものは通知しません。
- 自分の操作は、初期設定では通知しません。マージは自分の操作でも通知します。
- 通知は、生きている窓のうち最後に操作した窓にだけ出します。`/inbox log` にはどの窓でも入ります。
- `/inbox log` は窓（セッション）をまたいで共有します。別の窓の通知も、閉じた窓の通知も見られます。
- どの窓も開いていなかったあいだの更新は、次に開いた窓が最初の確認で `/inbox log` に入れ、件数だけを知らせます（1件ずつは出しません）。GitHub がまだ返す範囲で、最後に見てから30日以内のものに限ります。
- 通知・コマンド・ペインは初期設定では英語です。この README の例のように日本語で出すには、`/config` の **Language** を `ja` にします（[設定](#設定config)）。

## 必要なもの

- [GitHub CLI](https://cli.github.com/)（`gh`）で `gh auth login` を済ませていること。mod はトークンを持たず、`gh` に問い合わせます。

## インストール

```
/plugin install gh-inbox --marketplace kajidog/cc-mods-gh-inbox
```

## リポジトリを登録する

ブランチの PR とは別に、リポジトリを登録して、選んだ種類のイベントを通知できます。登録はマシン全体で共有し、どの窓からでも同じものを見ます。

```
/inbox repo add kajidog/cc-mods-tts              # 種類を選ぶペインが開きます
/inbox repo add kajidog/cc-mods-tts comment,push  # 種類を指定して登録
/inbox repo alias kajidog/cc-mods-tts tts         # 通知の先頭を [tts] にする
```

| 種類 | 内容 | 例 |
| --- | --- | --- |
| `branch` | ブランチ作成 | [tts] Aさんがブランチを作りました。feat/foo |
| `pr-open` | PR 作成 | [tts] Aさんが PR を作りました。#20 長い回答は要約だけ読む |
| `pr-merge` | PR マージ | [tts] #20 がマージされました。長い回答は要約だけ読む |
| `pr-close` | マージせずにクローズ | [tts] #21 がクローズされました。… |
| `comment` | PR・Issue へのコメント | [tts] レビューさんが #20 にコメントしました。この null チェック不要では |
| `review` | レビュー | [tts] レビューさんが #20 で変更を依頼しました。… |
| `review-comment` | 行へのコメント | [tts] レビューさんが #20 にコメントしました。src/a.ts:12 … |
| `push` | push | [tts] Aさんが main に push しました。fix: … / feat: … (+12 −3) |
| `ci-failure` | CI（GitHub Actions）の失敗 | [tts] CI / test の CI が失敗しました（feat/foo）。Run npm test |

- 種類を省いて登録すると、`pr-open`・`pr-merge`・`comment`・`review`・`ci-failure` で始まります。
- その窓で初めて見るリポジトリでは、すでにあるものは通知しません。
- 今のブランチの PR とリポジトリの両方に同じイベントが届いたときは、1回だけ通知します。今のブランチの PR の最新コミットの CI は、PR の通知のほうで出します。
- **リポジトリのイベントはリアルタイムではありません。** GitHub の Events API を使っていて、GitHub の説明では、届くまで30秒から6時間かかることがあります。残るのは直近90日・300件までです。

## レビューを Claude に渡す

`/inbox pick` を実行すると、PR のレビューとコメントの一覧がペインに出ます。いくつか選んで「添付する」を押すと、次に送るプロンプトと一緒に Claude に渡します。依頼の文はふつうにプロンプトに書きます。

```
/inbox pick               # 今のブランチの PR（PR がなければ PR を選ぶ画面から）
/inbox pick 12            # このリポジトリの #12
/inbox pick owner/repo#12 # 別のリポジトリの PR
/inbox clear              # 添付を外す
```

- 一覧はペインを開いたときに GitHub から取ってきます。通知されていないものや、窓を閉じていた間に付いたものも選べます。
- レビューごとに、その行コメントのスレッドを下に並べます。レビューを選ぶとスレッドもまとめて選び、スレッドを1つだけ選ぶこともできます。スレッドには返信も含まれます。
- 解決済みのスレッドも出します（「解決済み」と付きます）。どう対応したかを Claude に確かめてもらうときにも使えます。
- PR を選ぶ画面には、このリポジトリで開いている PR と、登録したリポジトリで自分が関わっている PR（レビューを頼まれた PR、レビューした PR も含む）が出ます。
- 添付している間は、プロンプトの上に件数を出します。「選び直す」と「外す」もここから操作できます。
- 添付は1回送ると外れます。スラッシュコマンドには付きません。
- 行コメントの差分は、コメントした行までの最後の15行だけを渡します。GitHub の画面に出ない HTML コメントは渡しません。差分とレビューにはどのコミットに対するものかを、前置きには PR の今の先頭コミットを添えます。
- スレッドとレビューは新しい100件、会話のコメントは新しい30件までです。それより多いときはペインにそう出ます。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/inbox` | 見ている PR と、その状態（CI・承認・コンフリクト・最新のコメント）、最後に確認した時刻 |
| `/inbox check` | すぐに確認する |
| `/inbox log` | どの窓のものも含めた通知（新しい20件。いつのことかを添えます。リポジトリの短い名前は色付きで、何をしたかの部分が GitHub へのリンクです） |
| `/inbox pick [PR]` | Claude に渡すスレッド・レビュー・コメントを選ぶ |
| `/inbox clear` | 添付を外す |
| `/inbox repo` | 登録したリポジトリと、通知する種類、最後に確認した時刻と最後のイベントの時刻の一覧 |
| `/inbox repo add owner/repo [種類,...]` | 登録する（種類を省くと、選ぶペインを開く） |
| `/inbox repo set owner/repo [種類,...]` | 種類を変える（種類を省くと、選ぶペインを開く） |
| `/inbox repo remove owner/repo` | 登録を外す |
| `/inbox repo alias owner/repo [短い名前]` | 通知の先頭に出す名前（省くと消す） |
| `/inbox nick <login> <ニックネーム>` | 表示名を短くする（`/inbox nick <login>` で削除、`/inbox nick` で一覧） |
| `/inbox tray [pull\|repos]` | プロンプトの下に出すものを、今のブランチの PR か登録したリポジトリ全体かに切り替える（省くと交互に切り替え） |

## 他の mod から使う

他の mod から、2つのイベントをフックできます。

- `inbox.notify`：通知を出す前。文を変えたり、通知を止めたりできます。
- `inbox.notified`：`inbox.notify` のフックが全部答えたあと。止められなかった通知が、表示する文のまま届きます。読み上げる、別の場所に送る、のように「出た通知に合わせて何かする」ときはこちらを使います（`inbox.notify` の途中で動くと、あとから他の mod が止めたり変えたりすることがあるためです）。

```ts
on("inbox.notify", async ($, e, next) => {
  if (e.isSelf) return { deny: "自分の操作は出さない" }  // 出さない
  return next({ ...e, text: `★ ${e.text}` })            // 文を変えて出す
})

on("inbox.notified", async ($, e, next) => {
  if (e.event.kind === "ci") void doSomething(e.text) // 出た通知に合わせて何かする
  return next(e)
})
```

| 項目 | 内容 |
| --- | --- |
| `event` | 通知の元になったイベント。`kind`（`comment` `review` `commit` `ci` `merge` `close` `branch` `open` `push`）、`pull`、`author`、`url`、本文の `items` など |
| `source` | `pull`: 今のブランチの PR / `repo`: 登録したリポジトリ |
| `repo` | `host/owner/repo` |
| `label` | 登録したリポジトリの別名（なければ名前）。今のブランチの PR では `null` |
| `isSelf` | `gh` でログインしているアカウントの操作か |
| `text` | 表示する文（`/config` の言語で） |

- 通知を出す窓（最後に操作した窓）でだけ呼ばれます。出し方（toast・log・notify）には関係なく呼ばれます。
- `{ deny }` で止めた通知は出さず、`inbox.notified` も呼びませんが、`/inbox log` には入ります。
- 一度にたくさん届いて「ほか N 件」にまとめた通知も、`inbox.notified` は1件ずつ呼びます。
- 通知を読み上げる [gh-inbox-tts](../gh-inbox-tts/README.ja.md) は、この仕組みで作っています。
- 型は `types/index.d.ts` の `Inbox` と `InboxNotice` です。`plugin.json` の `dependencies` に `gh-inbox` を書くと、`$.inbox` に型が付きます。

## 設定（`/config`）

| 項目 | 初期値 | 内容 |
| --- | --- | --- |
| Check interval | 60 | 確認の間隔（秒） |
| Where notices show | toast | `toast`: トースト / `log`: トランスクリプトの行 / `notify`: デスクトップ通知 |
| Repositories checked | 20 | 登録できるリポジトリの数 |
| Language | en | `en`: 英語 / `ja`: 日本語。通知・コマンド・ペインと、Claude に渡す文の言語 |
| Notify my own activity | false | 自分の操作も通知する |
| Tray | true | プロンプトの下に1行出し、確認のたびに更新する。今のブランチに PR があるあいだはその状態（`GitHub: #12 · CI ✗ 1/3 · 承認2 · コンフリクト · Aさん「この null チェック不要では」 5分前`）、PR がないときや `/inbox tray repos` のあとは、登録したリポジトリごとの最後のイベントが何分前か（`GitHub: r 5分前 · other 2時間前`） |

<details>
<summary>GitHub への負荷</summary>

- 確認は初期設定で60秒ごとです（30秒より短くはできません）。
- PR 1件の確認は GraphQL 1回、1ポイントです（1時間あたり5000ポイントまで使えます）。
- PR がないブランチは5分ごとにだけ探します。マージかクローズされた PR は、それ以上問い合わせません。
- 登録したリポジトリは、1件につき Events API を1回（`ci-failure` を選んでいれば Actions API も1回）問い合わせます。`ETag` を付けるので、変わっていなければ回数制限を使いません。GitHub が返す `X-Poll-Interval`（ふつう60秒）より短い間隔では問い合わせません。
- `/inbox pick` は、開いたときに GraphQL を1回問い合わせます。PR を選ぶ画面と `/inbox pick 12` では、今のリポジトリを `gh repo view` で1回調べ、PR を選ぶ画面ではホストごとに検索も1回します。
- 答えは窓の間で分け合います。新しい push のコミット（1回の確認で5件まで）、PR のタイトル、失敗したステップは、必要なときだけ追加で問い合わせます。

</details>

## 開発・ライセンス

リポジトリの [README](../../README.ja.md) を見てください。
