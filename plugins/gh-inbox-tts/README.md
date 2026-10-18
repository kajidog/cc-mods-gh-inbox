# gh-inbox-tts

[gh-inbox](../gh-inbox/README.md) の通知を、[tts](https://github.com/kajidog/cc-mods-tts) で読み上げる Claude Code の mod です。

- 通知が出る窓（最後に操作した窓）でだけ読みます。窓をいくつ開いていても、同じ通知を何度も読みません。
- 他の mod が止めた通知は読みません。文が書き換えられた通知は、書き換えたあとの文（表示される文）で読みます。
- 読み方（コード・URL を読まない、など）と声は tts の設定に従います。tts の読み上げモードが `notify` のときも読みます。

## インストール

tts は別のマーケットプレイスにあるので、先にそのマーケットプレイスを登録します。

```
/plugin marketplace add kajidog/cc-mods-tts
/plugin install gh-inbox-tts --marketplace kajidog/cc-mods-gh-inbox
```

- 登録しておけば、gh-inbox と tts がまだないときは一緒に入ります。
- 登録せずに入れると tts が入らず、gh-inbox-tts は読み込まれません。そのときは `/plugin marketplace add kajidog/cc-mods-tts` のあと `/reload-plugins` を実行してください。
- tts のセットアップ（VOICEVOX などのエンジン）は [tts の README](https://github.com/kajidog/cc-mods-tts) を見てください。

## 設定（`/config`）

| 項目 | 初期値 | 内容 |
| --- | --- | --- |
| Kinds read | （空） | 読む種類をカンマ区切りで。`comment` `review` `commit` `ci` `merge` `close` `branch` `open` `push`。空ならすべて |
| Repositories read | （空） | 読むリポジトリをカンマ区切りで。`owner/repo`、`host/owner/repo`、`/inbox repo alias` の別名のどれでも。空ならすべて（今のブランチの PR も含む） |
| Read my own activity | false | 自分の操作の通知も読む |
| What is said | `{text}` | 読む文。`{text}` 表示する文、`{body}` 先頭の `[別名]` を除いた文、`{label}` 別名、`{repo}` owner/repo、`{kind}` 種類、`{author}` GitHub のログイン名 |
| Interrupt | false | tts が読んでいる途中でも止めて、すぐに読む |

例: レビューと CI の失敗だけを、「tts、レビューさんが…」のように読む。

- Kinds read: `review,ci`
- What is said: `{label}、{body}`

## ライセンス

MIT
