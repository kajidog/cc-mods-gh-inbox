---
"gh-inbox": minor
---

While the branch has an open pull request, each new result of its CI goes to Claude with the next prompt you send: the commit it passed on, or each failed workflow, job and step with its link and the `gh run view --job … --log-failed` command that reads its log. Nothing is told while checks still run with none failed, and a result is told once. `/inbox pick` lists the head commit's CI first, to hand over with its annotations too. **Tell Claude about CI** in `/config` turns it off. No more requests are sent to GitHub for it.

今のブランチに開いている PR があるあいだは、その CI に新しい結果が出るたびに、次に送るプロンプトと一緒に Claude に渡すようにしました。成功ならどのコミットで通ったか、失敗ならワークフロー・ジョブ・ステップとそのリンク、ログを読む `gh run view --job … --log-failed` のコマンドを渡します。まだ実行中で失敗もないあいだは渡さず、同じ結果は1回だけ渡します。`/inbox pick` の一覧の先頭にも先頭コミットの CI が出て、アノテーションも含めて選んで渡せます。`/config` の **Tell Claude about CI** で止められます。GitHub への問い合わせは増えません。
