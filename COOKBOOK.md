# Junie GitHub Action Cookbook

Real-world recipes for automating development workflows with Junie. Each recipe solves a specific problem teams face daily.

## Setup

Before using any recipe, add your Junie API key to repository secrets:
1. Go to **Settings → Secrets and variables → Actions**
2. Create `JUNIE_API_KEY` with your key from [junie.labs.jb.gg](https://junie.labs.jb.gg/)

---

## Basic Interactive Setup

**Use this as your starting point.** This workflow enables interactive Junie assistance across issues and PRs - respond to `@junie-agent` mentions anywhere in your repository.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/junie.yml
name: Junie

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  junie:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@junie-agent')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@junie-agent')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@junie-agent')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@junie-agent') || contains(github.event.issue.title, '@junie-agent')))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Junie
        id: junie
        uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: true
```

</details>

**How to use:**
- Comment `@junie-agent implement email validation` on an issue → Junie creates a PR with the implementation
- Comment `@junie-agent add error handling here` on a PR → Junie implements the changes
- Create an issue with `@junie-agent` in the title or body → Junie analyzes and proposes a solution
- Submit a PR review mentioning `@junie-agent` → Junie addresses your feedback

**Features enabled:**
- ✅ Single comment mode - updates one comment instead of creating multiple
- ✅ Works on issues, PRs, comments, and reviews
- ✅ Only triggers on explicit `@junie-agent` mentions

**Optional enhancements:**
- Add `custom_github_token` to allow Junie's PRs to trigger other workflows (see README for setup)
- Add `create_new_branch_for_pr: "true"` to always create new branches instead of committing to existing ones
- Add specific `prompt` parameter for custom behavior

---

## 1. Automated Code Review

**Problem:** PRs sit waiting for review, slowing down delivery. You want consistent feedback on code quality, security issues, and best practices before human reviewers look at the code.

**Solution:** Junie automatically reviews every PR, leaving structured feedback with actionable suggestions.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/code-review.yml
name: Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: "true"
          prompt: |
            Review this PR for:

            **Security:**
            - SQL injection, XSS, exposed secrets
            - Authentication/authorization issues
            - Input validation vulnerabilities

            **Performance:**
            - N+1 queries, memory leaks
            - Inefficient algorithms (nested loops, etc.)
            - Blocking operations

            **Code Quality:**
            - Complexity, duplication, naming
            - Missing tests for new logic
            - Undocumented complex logic

            **Provide structured feedback:**
            ## 🎯 Summary
            [2-3 sentences overall assessment]

            ## ⚠️ Issues Found
            [Each issue: File:line, Severity (Critical/High/Medium/Low), Description, Suggested fix with code example]

            ## ✨ Highlights
            [1-2 things done well]

            ## 📋 Checklist
            - [ ] Security: No vulnerabilities
            - [ ] Tests: Adequate coverage
            - [ ] Performance: No bottlenecks
            - [ ] Documentation: Complex logic explained

            Do NOT modify any files.
```

</details>

**How it works:**
1. Triggers on PR open/update or when someone replies `@junie-agent`
2. Analyzes all changed files in the PR diff
3. Leaves a structured review comment with severity levels
4. Updates the same comment on subsequent runs (via `use_single_comment`)

**Next steps:**
- Add blocking reviews for critical issues (require approval before merge)
- Integrate with your team's style guide by adding project-specific rules
- Combine with CI checks: only run if tests pass

---

## 2. Sync Code → Documentation

**Problem:** README examples and API docs become outdated as code evolves. Manual updates are tedious and often forgotten.

**Solution:** Automatically update documentation when code changes are merged.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/sync-docs.yml
name: Sync Documentation

on:
  pull_request:
    types: [closed]
    branches:
      - main

jobs:
  update-docs:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          create_new_branch_for_pr: "true"
          base_branch: "main"
          prompt: |
            This PR was just merged. Update documentation to match code changes.

            **Check for outdated docs:**
            - README.md examples using changed APIs
            - API documentation (JSDoc, docstrings, OpenAPI)
            - Configuration examples (if config changed)
            - Migration guides (for breaking changes)

            **Update only if needed:**
            - Keep examples simple and runnable
            - Show before/after for breaking changes
            - Add "Added in vX.X" for new features
            - Only modify documentation files (README.md, docs/**)
            - If nothing to update, don't make changes
```

</details>

**How it works:**
1. Triggers when PR is merged to main
2. Analyzes code changes and finds outdated docs
3. Updates documentation and opens a new PR
4. Skips if no documentation updates are needed

**Customization:**
- Adjust `Main documentation files` path to match your project structure
- Add specific documentation patterns (Swagger, OpenAPI, TypeScript types)
- Include CHANGELOG.md updates

---

## 3. Fix Failing CI Tests

**Problem:** CI fails with cryptic errors. Developers waste time SSH-ing into runners, reading logs, and reproducing issues locally.

**Solution:** Junie analyzes failed CI runs, identifies root causes, and proposes fixes.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/fix-ci.yml
name: Fix CI Failures

on:
  workflow_run:
    workflows: ["CI"]  # Replace with your CI workflow name
    types: [completed]

jobs:
  analyze-failure:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      checks: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch }}
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          allowed_mcp_servers: "mcp_github_checks_server"
          use_single_comment: "true"
          prompt: |
            CI workflow "${{ github.event.workflow_run.name }}" failed. Diagnose and fix if possible.

            **Analysis:**
            1. Use `get_pr_failed_checks_info` MCP tool to fetch error logs
            2. Identify failing step and error message
            3. Determine root cause (test/build error, timeout, flaky test)
            4. Check recent commits that might have caused it

            **Provide diagnosis:**
            ## 🔴 CI Failure Analysis
            **Failed step:** [name]
            **Error:** [message]
            **Root cause:** [1-2 sentences]

            ## 🔧 Proposed Fix
            [Description]

            ## 📝 Files to Change
            - `path/file`: [what needs to change]

            ## 🧪 Test Locally
            [command to verify fix]

            **Fix simple issues only:**
            - Test failures: Fix failed assertion
            - Build errors: Add missing dependency or fix syntax
            - Timeouts: Optimize performance or increase limit
            - Flaky tests: Add retry logic or fix race condition

            Only provide analysis without modifying files.
```

</details>

**How it works:**
1. Triggers when your CI workflow completes with failure
2. Uses MCP GitHub Checks Server to fetch error logs
3. Analyzes the failure and identifies root cause
4. Provides detailed analysis

**Advanced:**
- Integrate with issue tracker (create bug report if fix is complex)
- Notify team Slack channel with analysis summary

---

## 4. Security Audit for Secrets

**Problem:** Developers accidentally commit API keys, passwords, or tokens. You need to catch these before they reach production.

**Solution:** Scan every commit for potential secrets and sensitive data.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/secret-audit.yml
name: Security Audit

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # Need parent commit for diff

      - uses: JetBrains/junie-github-action@v0
        id: junie
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          silent_mode: "true"
          prompt: |
            Scan git diff for accidentally committed secrets. Provide a structured report.

            **Look for:**
            - API keys (AWS, GCP, Azure, OpenAI, Stripe)
            - Private keys (RSA, SSH, PGP headers)
            - Passwords, auth tokens, JWT
            - Database connection strings, OAuth secrets

            **Patterns:**
            - `password=`, `secret=`, `token=`, `api_key=`
            - Long base64/hex strings (>20 chars)
            - `https://user:pass@host`
            - `-----BEGIN PRIVATE KEY-----`

            **Ignore false positives:**
            - Placeholders ("your-api-key-here", "example.com")
            - Test fixtures with dummy data
            - Encrypted values, public keys

            **Report format:**
            ## 🔐 Secret Scan Results

            **Status:** SECRETS_FOUND or CLEAN

            ### Issues Found:
            [If secrets found, list each one:]
            - **File:** path/file:line
            - **Type:** API Key / Private Key / Password / etc.
            - **Severity:** HIGH / MEDIUM
            - **Pattern:** [show redacted pattern, e.g., "aws_access_key=AKIA..."]
            - **Recommendation:** Remove from code, use GitHub Secrets

            [If no secrets found:]
            No secrets detected in this commit.

            Do NOT modify any files.

      - name: Check results
        if: steps.junie.outputs.junie_summary != ''
        run: |
          echo "${{ steps.junie.outputs.junie_summary }}"
          # Fail if secrets were found
          if echo "${{ steps.junie.outputs.junie_summary }}" | grep -q "SECRETS_FOUND"; then
            echo "::error::Secrets detected in commit! Review the summary above."
            exit 1
          fi
```

</details>

**How it works:**
1. Runs on every push and PR
2. Uses `silent_mode` to analyze without creating comments
3. Outputs structured report with findings
4. Fails CI if secrets are detected (checks for "SECRETS_FOUND" status)

**Integration:**
- Add to required status checks to block PRs with secrets
- Send Slack/email notifications on detection
- Automatically create private security issues

---

## 5. Dependency Update Assistant

**Problem:** Dependabot opens PRs for dependency updates, but you need to review changelogs, check for breaking changes, and update code accordingly.

**Solution:** Junie reviews dependency update PRs, summarizes changes, and updates code if needed.

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/dependency-review.yml
name: Dependency Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    # Only run on dependency update PRs
    if: |
      github.event.pull_request.user.login == 'dependabot[bot]' ||
      contains(github.event.pull_request.title, 'deps:') ||
      contains(github.event.pull_request.labels.*.name, 'dependencies')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: "true"
          prompt: |
            Review this dependency update.

            **Analysis:**
            1. Identify changed dependencies (package.json, requirements.txt, go.mod)
            2. Find CHANGELOG/migration guides
            3. Identify breaking changes and deprecations
            4. Search codebase for usage of changed APIs
            5. Determine impact on our code

            **Provide review:**
            ## 📦 Dependency Update Review
            **Updated:** [package] `v1.0.0` → `v2.0.0`

            **Changes:**
            - ✨ New features: [list]
            - ⚠️ Breaking changes: [list]
            - 🔧 Bug fixes: [list]

            **Impact on our code:**
            [Files/areas affected and what needs to change]

            **Links:** [Changelog] | [Migration guide]

            **Apply fixes only if easy:**
            - No breaking changes → Don't modify files
            - Simple fix (1-2 files) → Update code for breaking changes
            - Complex migration → Don't modify files, only provide analysis
```

</details>

**How it works:**
1. Triggers on PRs from Dependabot or labeled "dependencies"
2. Reads changelogs and identifies breaking changes
3. Searches codebase for affected usage
4. Applies fixes if straightforward, otherwise provides migration guide

**Tips:**
- Combine with automated testing (run tests after Junie's changes)
- Add auto-merge if Junie approves and tests pass
- Configure for specific types of updates (major vs patch)

---

## Need Help?

- 📘 Full documentation: [README.md](README.md)
- 🐛 Report issues: [GitHub Issues](https://github.com/JetBrains/junie-github-action/issues)
- 💬 Ask Junie: Open an issue and mention `@junie-agent`
