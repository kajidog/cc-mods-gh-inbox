// Answers GitHub gave for kajidog/cc-mods-tts on 2026-10-17, cut to the fields
// read, with a few made up beside them (a closed pull request, an approval, an
// issue comment, a new branch's push) for the cases the repository did not show.

const actor = (login: string) => ({ login, display_login: login })

/** `GET /repos/{owner}/{repo}/events`, newest first as GitHub lists them. */
export const EVENTS = [
  {
    id: "110",
    type: "PushEvent",
    actor: actor("newbie"),
    created_at: "2026-10-16T10:00:00Z",
    payload: { ref: "refs/heads/feat/new", before: "0000000000000000000000000000000000000000", head: "abcdef1234567890" },
  },
  {
    id: "109",
    type: "IssueCommentEvent",
    actor: actor("long-reviewer-name"),
    created_at: "2026-10-16T09:30:00Z",
    payload: {
      action: "created",
      issue: { number: 4, title: "Crash on start", html_url: "https://github.com/kajidog/cc-mods-tts/issues/4" },
      comment: { node_id: "IC_issue", body: "Same here", html_url: "https://github.com/kajidog/cc-mods-tts/issues/4#issuecomment-1" },
    },
  },
  {
    id: "108",
    type: "PullRequestEvent",
    actor: actor("kajidog"),
    created_at: "2026-10-16T09:20:00Z",
    payload: { action: "closed", number: 17, pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/17", number: 17 } },
  },
  {
    id: "107",
    type: "PullRequestReviewEvent",
    actor: actor("long-reviewer-name"),
    created_at: "2026-10-16T09:10:00Z",
    payload: {
      action: "created",
      review: { id: 1, node_id: "PRR_approve", state: "approved", body: null, html_url: "https://github.com/kajidog/cc-mods-tts/pull/18#pullrequestreview-1" },
      pull_request: { number: 18 },
    },
  },
  {
    id: "24253304731",
    type: "DeleteEvent",
    actor: actor("kajidog"),
    created_at: "2026-10-16T09:04:56Z",
    payload: { ref: "changeset-release/main", ref_type: "branch" },
  },
  {
    id: "17408512540",
    type: "PullRequestEvent",
    actor: actor("github-actions[bot]"),
    created_at: "2026-10-16T09:04:49Z",
    payload: { action: "merged", number: 19, pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/19", id: 4882748706, number: 19 } },
  },
  {
    id: "17360372678",
    type: "PullRequestEvent",
    actor: actor("github-actions[bot]"),
    created_at: "2026-10-16T02:50:05Z",
    payload: { action: "opened", number: 19, pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/19", id: 4882748706, number: 19 } },
  },
  {
    id: "24296160536",
    type: "CreateEvent",
    actor: actor("github-actions[bot]"),
    created_at: "2026-10-16T02:50:03Z",
    payload: { ref: "changeset-release/main", ref_type: "branch", full_ref: "refs/heads/changeset-release/main", master_branch: "main" },
  },
  {
    id: "24296132164",
    type: "PushEvent",
    actor: actor("kajidog"),
    created_at: "2026-10-16T02:49:47Z",
    payload: {
      repository_id: 1412711040,
      push_id: 46669380829,
      ref: "refs/heads/main",
      head: "427796ed7187b88d7ca760435c1fe4ba90441dba",
      before: "a952b0e24a96ef372c8550cba8f8f72892d17df0",
    },
  },
  {
    id: "17357055770",
    type: "PullRequestReviewEvent",
    actor: actor("reviewer"),
    created_at: "2026-10-16T01:30:07Z",
    payload: {
      action: "created",
      review: {
        id: 5541922809,
        node_id: "PRR_kwDOVDRCgM8AAAABSlMH-Q",
        state: "commented",
        body: null,
        html_url: "https://github.com/kajidog/cc-mods-tts/pull/18#pullrequestreview-5541922809",
      },
      pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/18", number: 18 },
    },
  },
  {
    id: "17357055913",
    type: "PullRequestReviewCommentEvent",
    actor: actor("reviewer"),
    created_at: "2026-10-16T01:30:05Z",
    payload: {
      action: "created",
      comment: {
        pull_request_review_id: 5541922809,
        node_id: "PRRC_kwDOVDRCgM7_s8-h",
        diff_hunk: "@@ -0,0 +1,34 @@\n+import { ENGINES } from",
        path: "hooks/config.js",
        body: "ローカルの型チェックで出力された `.js` が誤ってコミットに入っていました。",
        html_url: "https://github.com/kajidog/cc-mods-tts/pull/18#discussion_r4289974177",
      },
      pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/18", number: 18 },
    },
  },
  {
    id: "17436771456",
    type: "IssueCommentEvent",
    actor: actor("chatgpt-codex-connector[bot]"),
    created_at: "2026-10-15T23:31:53Z",
    payload: {
      action: "created",
      issue: {
        number: 18,
        title: "feat: 要約だけ読む設定を既定でオフにする",
        html_url: "https://github.com/kajidog/cc-mods-tts/pull/18",
        pull_request: { url: "https://api.github.com/repos/kajidog/cc-mods-tts/pulls/18" },
      },
      comment: {
        node_id: "IC_kwDOVDRCgM8AAAABcdCdCg",
        body: "Codex Review: Didn't find any major issues.",
        html_url: "https://github.com/kajidog/cc-mods-tts/pull/18#issuecomment-6204464394",
      },
    },
  },
]

/** `compareArgv`'s answer for the push to main above. */
export const COMPARE = {
  additions: 15,
  commits: [{ author: "kajidog", sha: "427796ed7187b88d7ca760435c1fe4ba90441dba", title: "feat: 要約だけ読む設定を既定でオフにする (#18)" }],
  deletions: 10,
}

/** `GET /repos/{owner}/{repo}/actions/runs?status=completed`. */
export const RUNS = {
  total_count: 2,
  workflow_runs: [
    {
      id: 39000000002,
      name: "test",
      head_branch: "feat/foo",
      head_sha: "f00",
      html_url: "https://github.com/kajidog/cc-mods-tts/actions/runs/39000000002",
      updated_at: "2026-10-16T11:00:00Z",
      run_attempt: 2,
      conclusion: "failure",
    },
    {
      id: 39000000001,
      name: "test",
      head_branch: "main",
      head_sha: "a11",
      html_url: "https://github.com/kajidog/cc-mods-tts/actions/runs/39000000001",
      updated_at: "2026-10-16T10:30:00Z",
      run_attempt: 1,
      conclusion: "failure",
    },
  ],
}

/** `GET /repos/{owner}/{repo}/actions/runs/{id}/attempts/{n}/jobs`. */
export const JOBS = {
  jobs: [
    { name: "lint", conclusion: "success", steps: [{ name: "Set up job", conclusion: "success" }] },
    {
      name: "test (ubuntu-latest)",
      conclusion: "failure",
      steps: [
        { name: "Set up job", conclusion: "success" },
        { name: "Run npm test", conclusion: "failure" },
        { name: "Post Run actions/checkout@v4", conclusion: "skipped" },
      ],
    },
  ],
}

/** `titlesArgv`'s answer, with a number that is not a pull request. */
export const TITLES = {
  data: {
    repository: {
      pr17: { title: "WIP: try another engine", author: { login: "kajidog" } },
      pr18: { title: "feat: 要約だけ読む設定を既定でオフにする", author: { login: "kajidog" } },
      pr19: { title: "Version Packages", author: { login: "app/github-actions" } },
      pr4: null,
    },
  },
  errors: [{ type: "NOT_FOUND", path: ["repository", "pr4"], message: "Could not resolve to a PullRequest with the number of 4." }],
}
