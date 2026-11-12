---
"gh-inbox": minor
---

`/inbox approve` approves a pull request and `/inbox unapprove` withdraws your approval, each once you confirm it in the pane, as `/inbox merge` does. The approval is of the head commit the pane showed. Your own pull request, one you have approved already, and withdrawing an approval you have not given are refused before any pane. Withdrawing dismisses your approving review, which GitHub keeps on the pull request with why.

`/inbox approve` で PR を承認し、`/inbox unapprove` で自分の承認を取り消せるようにしました。`/inbox merge` と同じく、ペインで確かめてから行います。承認するのは、ペインに出した先頭のコミットです。自分の PR、もう承認している PR、承認していない PR の取り消しは、ペインを開く前に断ります。取り消しは自分の承認レビューの却下（dismiss）として行い、GitHub の PR に理由と一緒に残ります。
