# Junie GitHub Action Cookbook

Real-world recipes for automating development workflows with Junie. Each recipe solves a specific problem teams face daily.

## Setup

Before using any recipe, add your Junie API key to repository secrets:
1. Go to **Settings → Secrets and variables → Actions**
2. Create `JUNIE_API_KEY` with your key from [junie.jetbrains.com](https://junie.jetbrains.com/)

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
        uses: JetBrains/junie-github-action@v1
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
- Comment `@junie-agent resolve conflicts` on a PR with merge conflicts → Junie resolves the conflicts
- Comment `@junie-agent minor-fix rename variable x to y` in a PR → Junie makes the requested adjustment

**Features enabled:**
- ✅ Minor Fixes - quickly implement small PR adjustments with `minor-fix`
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

### Option A: Use Built-in Code Review (Recommended)

Use the built-in `code-review` prompt for a structured PR review:

<details>
<summary>View complete workflow</summary>

```yaml
# .github/workflows/code-review.yml
name: Code Review

on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]

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
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: "true"
          prompt: "code-review"
```

</details>

The built-in review provides structured feedback directly on the PR.

### Option B: Custom Review Prompt

For custom review criteria, provide your own detailed prompt:

<details>
<summary>View complete workflow with custom prompt</summary>

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
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: "true"
          prompt: |
            Your task is to:
            1. Get the Pull Request diff using `git diff origin/${{ github.event.pull_request.base.ref }}...`
            2. Review this diff according to the criteria below
            3. Output summary following the template below using `submit` action

            ## Review Criteria

            ```
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
            ```

            ## Summary template

            ```
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

            ## Additional instructions
            - Strictly follow the plan above (`Your task is to:` section)
            - You are not expected to explore the repo. Do review solely based on the downloaded diff
            - You are not expected to run any code or any commands except `git diff`
```

</details>

### Option C: On-Demand Code Review via Comments

You can also trigger code reviews on-demand by commenting on a PR with the `code-review` phrase:

```
@junie-agent code-review
```

This works with any workflow that has issue/PR comment triggers configured. The same built-in code review prompt will be used automatically.

**How it works:**
1. Triggers on PR open/update or when someone replies `@junie-agent` or uses `@junie-agent code-review`
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
    branches: [main]

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
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          create_new_branch_for_pr: "true"
          prompt: |
            Review pr diff and update documentation to match code changes.

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

            Procedure:
            Use git diff origin/${{ github.event.pull_request.base.ref }}... to get a diff of the PR.
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

**Solution:** Junie analyzes failed CI runs, identifies root causes, and implements fixes automatically.

### Option A: Use Built-in Fix CI (Recommended)

Use the built-in `fix-ci` prompt for automatic CI failure analysis with structured output:

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
    # Don't run on Junie's own PRs to avoid infinite loops
    if: |
      github.event.workflow_run.conclusion == 'failure' &&
      !startsWith(github.event.workflow_run.head_branch, 'junie/')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      checks: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch }}
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          allowed_mcp_servers: "mcp_github_checks_server"
          use_single_comment: "true"
          create_new_branch_for_pr: "true"
          prompt: "fix-ci"
```

</details>

The built-in fix-ci prompt:
- **Retrieves failed check information** using MCP GitHub Checks Server
- **Analyzes root causes** - test failures, build errors, linting issues, timeouts, flaky tests
- **Correlates with PR changes** - determines if failure is related to the PR or pre-existing
- **Implements fixes automatically** - analyzes the issue and creates a PR with the fix (when `create_new_branch_for_pr` is enabled)

### Option B: Custom Fix CI Prompt

For custom analysis criteria, provide your own detailed prompt:

<details>
<summary>View complete workflow with custom prompt</summary>

```yaml
# .github/workflows/fix-ci.yml
name: Fix CI Failures

on:
  workflow_run:
    workflows: ["CI"]  # Replace with your CI workflow name
    types: [completed]

jobs:
  analyze-failure:
    # Don't run on Junie's own PRs to avoid infinite loops
    if: |
      github.event.workflow_run.conclusion == 'failure' &&
      !startsWith(github.event.workflow_run.head_branch, 'junie/')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      checks: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch }}
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          allowed_mcp_servers: "mcp_github_checks_server"
          use_single_comment: "true"
          create_new_branch_for_pr: "true"
          prompt: |
            CI workflow "${{ github.event.workflow_run.name }}" failed. Diagnose, provide analytics and suggest fix.

            **Analysis:**
            1. Retrieve detailed information about failed CI/CD checks
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

            Only provide analysis and suggest fix without modifying files.
```

</details>

### Option C: On-Demand Fix CI via Comments

You can also trigger CI failure analysis on-demand by commenting on a PR with the `fix-ci` phrase:

```
@junie-agent fix-ci
```

This works with any workflow that has issue/PR comment triggers configured. The same built-in fix-ci prompt will be used automatically.

**How it works:**
1. Triggers when your CI workflow completes with failure or when someone uses `@junie-agent fix-ci`
2. Skips Junie's own branches (`junie/`) to prevent infinite loops if Junie's fix causes another CI failure
3. Uses MCP GitHub Checks Server to fetch error logs
4. Analyzes the failure and identifies root cause
5. Implements the fix in the codebase
6. Creates a new branch and PR with the fix (via `create_new_branch_for_pr`)

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
    branches: [main]

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
          fetch-depth: 1

      - uses: JetBrains/junie-github-action@v1
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

            Procedure:
            Use git diff origin/${{ github.event.pull_request.base.ref }}... to get a diff of the PR.

            Only provide feedback without modifying files.

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

## Need Help?

- 📘 Full documentation: [README.md](README.md)
- 🐛 Report issues: [GitHub Issues](https://github.com/JetBrains/junie-github-action/issues)
- 💬 Ask Junie: Open an issue and mention `@junie-agent`
