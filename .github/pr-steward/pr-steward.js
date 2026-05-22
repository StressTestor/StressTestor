const [owner, repo] = process.env.REPOSITORY.split("/");
const token = process.env.GITHUB_TOKEN;
const marker = "<!-- pr-steward-review -->";

const trustedAuthors = csv("TRUSTED_AUTHORS", "StressTestor,dependabot[bot],renovate[bot],github-actions[bot]").map((v) => v.toLowerCase());
const holdLabels = new Set(csv("HOLD_LABELS", "hold,blocked,do-not-merge,wip").map((v) => v.toLowerCase()));
const automergeLabels = new Set(csv("AUTOMERGE_LABELS", "automerge,safe-to-automerge").map((v) => v.toLowerCase()));
const riskOverrideLabel = (process.env.RISK_OVERRIDE_LABEL || "safe-to-automerge").toLowerCase();
const maxChangedFiles = numberEnv("MAX_CHANGED_FILES", 20);
const maxDiffLines = numberEnv("MAX_DIFF_LINES", 800);
const dryRun = (process.env.DRY_RUN || "false").toLowerCase() === "true";
const preferredMethod = process.env.MERGE_METHOD || "squash";
const okCheckConclusions = new Set(["success", "neutral", "skipped"]);
const okMergeableStates = new Set(["clean", "unstable", "has_hooks"]);
const riskyPathPatterns = [
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /(^|\/)\.env($|[.-])/,
  /(^|\/)(id_rsa|id_dsa|id_ed25519|.*\.pem|.*\.key)$/,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/,
  /(^|\/)(auth|security|permissions|migrations?|schema|supabase|terraform|infra|deploy|scripts)\//
];

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  if (!owner || !repo || !token) throw new Error("REPOSITORY and GITHUB_TOKEN are required");
  const prs = await targetPullRequests();
  if (prs.length === 0) {
    console.log("No open pull requests to review.");
    return;
  }

  for (const pr of prs) await reviewPullRequest(pr.number);
}

async function targetPullRequests() {
  if (process.env.EVENT_PR) {
    const pr = await getPullRequest(process.env.EVENT_PR);
    return pr.state === "open" ? [pr] : [];
  }

  return paginate(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
}

async function reviewPullRequest(number) {
  let pr = await getPullRequest(number);
  if (pr.mergeable === null) {
    await sleep(5000);
    pr = await getPullRequest(number);
  }

  const labels = new Set((pr.labels || []).map((label) => label.name.toLowerCase()));
  const files = await paginate(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
  const reviews = await paginate(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
  const checkRuns = await getCheckRuns(pr.head.sha);
  const combinedStatus = await api(`/repos/${owner}/${repo}/commits/${pr.head.sha}/status`);

  const changedFiles = files.length;
  const diffLines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const riskyFiles = files
    .map((file) => file.filename)
    .filter((filename) => riskyPathPatterns.some((pattern) => pattern.test(filename)));
  const latestReviewStates = latestReviewsByUser(reviews);
  const changesRequested = [...latestReviewStates.values()].some((state) => state === "CHANGES_REQUESTED");
  const checks = checkSummary(checkRuns, combinedStatus);
  const hasHoldLabel = [...labels].some((label) => holdLabels.has(label));
  const hasAutomergeLabel = [...labels].some((label) => automergeLabels.has(label));
  const hasRiskOverride = labels.has(riskOverrideLabel);
  const trustedAuthor = trustedAuthors.includes(pr.user.login.toLowerCase());
  const mergeable = pr.mergeable === true && okMergeableStates.has(pr.mergeable_state);

  const blockers = [];
  if (pr.draft) blockers.push("PR is still a draft");
  if (hasHoldLabel) blockers.push("hold label is present");
  if (!mergeable) blockers.push(`mergeable state is ${pr.mergeable_state || "unknown"}`);
  if (changesRequested) blockers.push("a reviewer requested changes");
  if (!checks.any) blockers.push("no status checks or check runs were found");
  if (!checks.ok) blockers.push("one or more status checks failed, are pending, or were cancelled");
  if (changedFiles > maxChangedFiles) blockers.push(`${changedFiles} changed files exceeds limit ${maxChangedFiles}`);
  if (diffLines > maxDiffLines) blockers.push(`${diffLines} changed lines exceeds limit ${maxDiffLines}`);
  if (riskyFiles.length > 0 && !hasRiskOverride) blockers.push(`risky paths changed: ${riskyFiles.slice(0, 5).join(", ")}`);
  if (!trustedAuthor && !hasAutomergeLabel) blockers.push("author is not trusted and no automerge label is present");

  const shouldMerge = blockers.length === 0;
  let action = shouldMerge ? "ready to merge" : "reviewed, not merged";
  if (shouldMerge) {
    action = dryRun ? "would merge, but dry run is enabled" : await mergePullRequest(pr);
  }

  await upsertReviewComment(number, renderComment({
    pr,
    action,
    trustedAuthor,
    hasAutomergeLabel,
    changedFiles,
    diffLines,
    riskyFiles,
    checks,
    blockers
  }));

  console.log(`#${number}: ${action}`);
}

async function mergePullRequest(pr) {
  const methods = [...new Set([preferredMethod, "squash", "merge", "rebase"])]
    .filter((method) => ["squash", "merge", "rebase"].includes(method));
  const errors = [];

  for (const method of methods) {
    try {
      const result = await api(`/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
        method: "PUT",
        body: {
          commit_title: `${pr.title} (#${pr.number})`,
          merge_method: method,
          sha: pr.head.sha
        }
      });
      if (result.merged) return `merged with ${method}`;
    } catch (error) {
      errors.push(`${method}: ${error.message}`);
    }
  }

  return `merge failed: ${errors.join("; ")}`;
}

function renderComment(details) {
  const blockerText = details.blockers.length === 0
    ? "none"
    : details.blockers.map((item) => `- ${item}`).join("\n");
  const riskyText = details.riskyFiles.length === 0
    ? "none"
    : details.riskyFiles.slice(0, 10).map((item) => `- ${item}`).join("\n");

  return `${marker}
### pr steward review

status: ${details.action}

| gate | result |
| --- | --- |
| author | ${details.pr.user.login}${details.trustedAuthor ? " (trusted)" : ""} |
| automerge label | ${details.hasAutomergeLabel ? "present" : "absent"} |
| mergeable | ${details.pr.mergeable_state || "unknown"} |
| checks | ${details.checks.summary} |
| changed files | ${details.changedFiles} |
| changed lines | ${details.diffLines} |

blockers:
${blockerText}

risky paths:
${riskyText}
`;
}

async function upsertReviewComment(number, body) {
  const comments = await paginate(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  const previous = comments.find((comment) => comment.body && comment.body.includes(marker));
  if (previous) {
    await api(`/repos/${owner}/${repo}/issues/comments/${previous.id}`, {
      method: "PATCH",
      body: { body }
    });
    return;
  }

  await api(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body }
  });
}

function latestReviewsByUser(reviews) {
  const latest = new Map();
  for (const review of reviews) latest.set(review.user.login, review.state);
  return latest;
}

function checkSummary(checkRuns, combinedStatus) {
  const runs = checkRuns.filter((run) => !/pr steward/i.test(run.name));
  const badRuns = runs.filter((run) => run.status !== "completed" || !okCheckConclusions.has(run.conclusion));
  const statuses = combinedStatus.statuses || [];
  const badStatuses = statuses.filter((status) => status.state !== "success");
  const any = runs.length > 0 || statuses.length > 0;
  return {
    any,
    ok: any && badRuns.length === 0 && badStatuses.length === 0 && combinedStatus.state !== "failure" && combinedStatus.state !== "pending",
    summary: `${runs.length} check runs, ${statuses.length} statuses`
  };
}

async function getCheckRuns(sha) {
  const data = await api(`/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  return data.check_runs || [];
}

async function getPullRequest(number) {
  return api(`/repos/${owner}/${repo}/pulls/${number}`);
}

async function paginate(path) {
  const items = [];
  let page = 1;
  while (true) {
    const joiner = path.includes("?") ? "&" : "?";
    const data = await api(`${path}${joiner}page=${page}`);
    const batch = Array.isArray(data) ? data : [];
    items.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return items;
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers || {})
  };
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 204) return {};
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${data.message || text}`);
  return data;
}

function csv(name, fallback = "") {
  return (process.env[name] || fallback).split(",").map((value) => value.trim()).filter(Boolean);
}

function numberEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
