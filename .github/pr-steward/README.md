# pr steward

This is the central script used by the `pr steward` GitHub Actions workflow across StressTestor repos.

The workflow reviews open PRs by GitHub API metadata only. It does not check out PR code.

## merge policy

A PR is auto-merged only when all gates pass:

| gate | rule |
| --- | --- |
| draft state | PR is not a draft |
| labels | no `hold`, `blocked`, `do-not-merge`, or `wip` label |
| mergeability | GitHub reports the PR as mergeable |
| reviews | no reviewer has requested changes |
| checks | at least one check/status exists and all are passing |
| size | at most 20 changed files and 800 changed lines |
| risky paths | no risky paths changed unless `safe-to-automerge` is present |
| author policy | author is trusted, or an `automerge`/`safe-to-automerge` label is present |

Trusted authors default to `StressTestor`, `dependabot[bot]`, `renovate[bot]`, and `github-actions[bot]`.

## labels

| label | effect |
| --- | --- |
| `automerge` | allows a non-trusted author through the author gate |
| `safe-to-automerge` | allows a non-trusted author and overrides risky-path blocking |
| `hold` | blocks auto-merge |
| `blocked` | blocks auto-merge |
| `do-not-merge` | blocks auto-merge |
| `wip` | blocks auto-merge |

## defaults

The per-repo workflow pins this script by commit SHA. Update the workflow stubs when intentionally rolling out a new steward version.
