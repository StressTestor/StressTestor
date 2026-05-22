# architecture

## project overview

This is the `StressTestor` profile repository. It stores profile README content and shared account-level GitHub automation used by other `StressTestor` repositories.

## stack and dependencies

| part | choice |
| --- | --- |
| profile content | Markdown |
| PR steward runtime | GitHub Actions Ubuntu runner |
| PR steward script | Node.js with built-in `fetch` |
| external actions | none |
| secrets | none |

## directory structure

```text
.
├── .github/
│   └── pr-steward/
│       ├── README.md
│       └── pr-steward.js
├── ARCHITECTURE.md
└── README.md
```

## key patterns

The PR steward script is pinned by commit SHA from per-repo workflow stubs. It uses the target repository's `GITHUB_TOKEN`, so its write permissions stay scoped to the repository running the workflow.

The steward never checks out pull request code. It reads GitHub API metadata, updates one marker comment per PR, and merges only after conservative gates pass.

## database schema

None.

## environment variables

| variable | default | purpose |
| --- | --- | --- |
| `REPOSITORY` | `${{ github.repository }}` in workflow stubs | target repo in `owner/name` form |
| `GITHUB_TOKEN` | `${{ github.token }}` in workflow stubs | token scoped to the target repo |
| `EVENT_PR` | event PR number when present | limits event runs to one PR |
| `TRUSTED_AUTHORS` | `StressTestor,dependabot[bot],renovate[bot],github-actions[bot]` | authors allowed through the author gate |
| `HOLD_LABELS` | `hold,blocked,do-not-merge,wip` | labels that block auto-merge |
| `AUTOMERGE_LABELS` | `automerge,safe-to-automerge` | labels that allow non-trusted authors |
| `RISK_OVERRIDE_LABEL` | `safe-to-automerge` | label that allows risky paths |
| `MAX_CHANGED_FILES` | `20` | changed-file limit |
| `MAX_DIFF_LINES` | `800` | changed-line limit |
| `MERGE_METHOD` | `squash` | preferred merge method |
| `DRY_RUN` | `false` | comments without merging when true |

## deployment and infrastructure

The central script lives in `.github/pr-steward/pr-steward.js`. Target repositories run a small `.github/workflows/pr-steward.yml` stub that downloads this script from `raw.githubusercontent.com` at a pinned commit SHA.

## external services and integrations

| service | use |
| --- | --- |
| GitHub Actions | scheduled and event-driven execution |
| GitHub REST API | PR inspection, comment updates, and merges |
| raw.githubusercontent.com | fetches the pinned steward script in target workflows |

## gotchas

GitHub repository Actions settings must allow `GITHUB_TOKEN` write permissions for comments and merges.

Branch protection can still block a merge, which is intentional.

Repos without checks or statuses are reviewed but not auto-merged.

## commands

```bash
node --check .github/pr-steward/pr-steward.js
```

## last updated

2026-05-22
