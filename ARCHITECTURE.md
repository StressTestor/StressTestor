# architecture

## project overview

This is the `StressTestor` profile repository. It stores profile README content and shared account-level GitHub automation used by other `StressTestor` repositories.

## stack and dependencies

| part | choice |
| --- | --- |
| profile content | Markdown |
| AI PR review | `openai/codex-action@v1` |
| coding model | `gpt-5.3-codex` by default |
| workflow runtime | GitHub Actions Ubuntu runner |
| merge gate script | `actions/github-script@v7` + GitHub REST API |
| checkout | `actions/checkout@v5` |
| required secret | `CODEX_ACCESS_TOKEN` in each target repo or organization |

## directory structure

```text
.
├── .github/
│   ├── pr-steward/
│   │   ├── README.md
│   │   └── pr-steward.js        # legacy deterministic steward retained for reference
│   └── workflows/
│       ├── codex-pr-steward-reusable.yml
│       ├── codex-pr-steward.yml
│       └── pr-steward.yml       # caller workflow for this repo
├── ARCHITECTURE.md
└── README.md
```

## key patterns

Target repositories run a small `.github/workflows/pr-steward.yml` caller that invokes the reusable workflow in this repo.

The reusable workflow checks out the PR merge ref, runs Codex with `openai/codex-action@v1`, posts or updates one PR comment marked with `<!-- codex-pr-review -->`, and asks Codex to include a machine-readable verdict marked with `<!-- codex-review-verdict ... -->`.

Codex authenticates with a ChatGPT/Codex access token passed as `CODEX_ACCESS_TOKEN`. The workflow no longer passes an OpenAI Platform API key.

Auto-merge requires both the AI verdict and deterministic gates:

| gate | rule |
| --- | --- |
| Codex verdict | `merge_safe: true` and severity below `medium` |
| draft state | PR is not a draft |
| labels | no `hold`, `blocked`, `do-not-merge`, or `wip` label |
| mergeability | GitHub reports the PR as mergeable |
| reviews | no reviewer has requested changes |
| checks | at least one check/status exists and all checks are passing |
| author policy | author is trusted, or an `automerge` / `safe-to-automerge` label is present |

## database schema

None.

## environment variables

| variable | default | purpose |
| --- | --- | --- |
| `CODEX_ACCESS_TOKEN` | repo or organization secret | ChatGPT-backed Codex access token used by `codex exec` |
| `REVIEW_MARKER` | `<!-- codex-pr-review -->` | marker for the upserted review comment |
| `model` input | `gpt-5.3-codex` | Codex model used for reviews |
| `effort` input | `high` | Codex reasoning effort |
| `merge_method` input | `squash` | preferred merge method |
| `trusted_authors` input | `StressTestor,dependabot[bot],renovate[bot],github-actions[bot]` | authors allowed through the author gate |
| `hold_labels` input | `hold,blocked,do-not-merge,wip` | labels that block auto-merge |
| `automerge_labels` input | `automerge,safe-to-automerge` | labels that allow non-trusted authors |

## deployment and infrastructure

The reusable workflow lives at `.github/workflows/codex-pr-steward-reusable.yml` in this repo. Target repos call it from their `.github/workflows/pr-steward.yml` files.

Each target repo needs access to a `CODEX_ACCESS_TOKEN` Actions secret before Codex review can run. Without the secret, the workflow posts a configuration comment and refuses to merge.

## external services and integrations

| service | use |
| --- | --- |
| GitHub Actions | PR event execution |
| GitHub REST API | PR comments, check inspection, review inspection, merge |
| OpenAI Codex Action | AI code review through Codex |
| Codex access token | ChatGPT-plan authentication for `codex exec` |

## gotchas

Do not commit or print local Codex auth cache files. Generate a Codex access token and store it as `CODEX_ACCESS_TOKEN` in GitHub Actions secrets.

Branch protection can still block a merge, which is intentional.

Repos without checks or statuses are reviewed but not auto-merged.

Existing PRs whose base branch does not contain the workflow will not trigger it until the workflow is added to that base branch or the PR is retargeted to a branch that has it.

## commands

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/codex-pr-steward-reusable.yml")'
```

## last updated

2026-05-22