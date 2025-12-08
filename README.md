# Junie GitHub Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Junie%20Action-blue.svg?colorA=24292e&colorB=0366d6&style=flat&longCache=true&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAM6wAADOsB5dZE0gAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAERSURBVCiRhZG/SsMxFEZPfsVJ61jbxaF0cRQRcRJ9hlYn30IHN/+9iquDCOIsblIrOjqKgy5aKoJQj4O3EEtbPwhJbr6Te28CmdSKeqzeqr0YbfVIrTBKakvtOl5dtTkK+v4HfA9PEyBFCY9AGVgCBLaBp1jPAyfAJ/AAdIEG0dNAiyP7+K1qIfMdonZic6+WJoBJvQlvuwDqcXadUuqPA1NKAlexbRTAIMvMOCjTbMwl1LtI/6KWJ5Q6rT6Ht1MA58AX8Apcqqt5r2qhrgAXQC3CZ6i1+KMd9TRu3MvA3aH/fFPnBodb6oe6HM8+lYHrGdRXW8M9bMZtPXUji69lmf5Cmamq7quNLFZXD9Rq7v0Bpc1o/tp0fisAAAAASUVORK5CYII=)](https://github.com/marketplace/actions/junie-github-action)
[![Release](https://img.shields.io/github/v/release/JetBrains/junie-github-action)](https://github.com/JetBrains/junie-github-action/releases)
[![License](https://img.shields.io/github/license/JetBrains/junie-github-action)](LICENSE)

A powerful GitHub Action that integrates [Junie](https://www.jetbrains.com/junie/) (JetBrains' AI coding agent) into your GitHub workflows to automate code changes, issue resolution, PR management, and conflict resolution. Junie can understand your codebase, implement fixes, review changes, and respond to developer requests directly in issues and pull requests.

## 📑 Table of Contents

- [Features](#features)
- [Quickstart](#quickstart)
  - [Prerequisites](#prerequisites)
  - [Basic Setup](#basic-setup)
- [Configuration](#configuration)
  - [Input Parameters](#input-parameters)
  - [Outputs](#outputs)
  - [Required Permissions](#required-permissions)
  - [GitHub Token Considerations](#github-token-considerations)
- [Use Cases & Examples](#use-cases--examples)
  - [Interactive Development](#interactive-development)
  - [Conflict Resolution](#conflict-resolution)
  - [Silent Mode (Output-Only)](#silent-mode-output-only)
  - [Single Comment Mode](#single-comment-mode)
  - [CI Failure Analysis](#ci-failure-analysis)
  - [Custom Automation](#custom-automation)
  - [Label-Based Triggers](#label-based-triggers)
- [Real-World Examples](#real-world-examples)
- [How It Works](#how-it-works)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Features

- **Interactive Code Assistant**: Responds to @junie-agent mentions in comments, issues, and PRs
- **Issue Resolution**: Automatically implements solutions for GitHub issues
- **PR Management**: Reviews code changes and implements requested modifications
- **Conflict Resolution**: Resolve merge conflicts via `@junie-agent` comment or automatic detection
- **CI Failure Analysis**: Investigates failed checks and suggests fixes using MCP integration
- **Flexible Triggers**: Activate via mentions, assignees, labels, or custom prompts
- **Smart Branch Management**: Context-aware branch creation and management
- **Silent Mode**: Run analysis-only workflows without comments or git operations
- **Single Comment Mode**: Update a single comment instead of creating multiple comments for each run (per workflow)
- **Comprehensive Feedback**: Real-time updates via GitHub comments with links to PRs and commits
- **Rich Job Summaries**: Beautiful markdown reports in GitHub Actions with execution details
- **MCP Extensibility**: Integrate custom Model Context Protocol servers for enhanced capabilities
- **Runs on Your Infrastructure**: Executes entirely on your GitHub runners

## Quickstart

### Prerequisites

1. **Junie API Key**: Obtain from [JetBrains Junie](https://junie.labs.jb.gg/)
2. **Repository Permissions**: Admin access to configure secrets and workflows

### Basic Setup

You can set up Junie in two ways:

#### Option 1: Automatic Setup (Recommended)

Visit [https://junie.labs.jb.gg/cli](https://junie.labs.jb.gg/cli) and follow the interactive setup wizard. It will automatically:
- Configure repository secrets
- Create workflow files
- Set up proper permissions

#### Option 2: Manual Setup

1. Add your Junie API key to repository secrets:
   - Go to **Settings → Secrets and variables → Actions**
   - Create a new secret named `JUNIE_API_KEY`

2. Create `.github/workflows/junie.yml` in your repository:

```yaml
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
```

**Version Tags:**
- Use `@v1` for the latest v1.x.x version (recommended - automatically gets updates)
- Use `@v0` for the latest v0.x.x version (pre-release)
- Use `@v1.0.0` for a specific version (pinned - no automatic updates)
- Use `@main` for the latest development version (not recommended for production)

3. Start using Junie:
   - Comment `@junie-agent help me fix this bug` on an issue
   - Mention `@junie-agent review this change` in a PR
   - Add the `junie` label to trigger automatically

## Configuration

### Input Parameters

#### Trigger Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `trigger_phrase` | Phrase to activate Junie in comments/issues | `@junie-agent` |
| `assignee_trigger` | Username that triggers when assigned | - |
| `label_trigger` | Label that triggers the action | `junie` |

#### Branch Management

| Input | Description | Default |
|-------|-------------|---------|
| `base_branch` | Base branch for creating new branches | `github.base_ref` |
| `create_new_branch_for_pr` | Create new branch for PR contributors | `false` |

#### Junie Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `prompt` | Custom instructions for Junie | - |
| `junie_version` | Junie CLI version to install | `532.2.0` |
| `junie_work_dir` | Working directory for Junie files | `/tmp/junie-work` |
| `allowed_mcp_servers` | MCP servers to enable (comma-separated) | - |

**Available MCP Servers**:
- `mcp_github_checks_server`: Analyze failed GitHub Actions checks

#### Advanced Features

| Input | Description | Default |
|-------|-------------|---------|
| `resolve_conflicts` | Enable automatic conflict detection (not needed for manual `@junie-agent` resolution) | `false` |
| `silent_mode` | Run Junie without comments, branch creation, or commits - only prepare data and output results | `false` |
| `use_single_comment` | Update a single comment for all runs instead of creating new comments each time | `false` |

#### Authentication

| Input | Description | Required |
|-------|-------------|----------|
| `junie_api_key` | JetBrains Junie API key | Yes |
| `custom_github_token` | Custom GitHub token (optional) | No |

### Outputs

| Output | Description |
|--------|-------------|
| `branch_name` | Name of the working branch created by Junie |
| `should_skip` | Whether Junie execution was skipped (no trigger matched or no write permissions) |
| `commit_sha` | SHA of the commit created by Junie (if any) |
| `pr_url` | URL of the pull request created by Junie (if any) |
| `junie_title` | Title of the task completion from Junie |
| `junie_summary` | Summary of the changes made by Junie |
| `github_token` | The GitHub token used by the action |

**Example usage:**

```yaml
- uses: JetBrains/junie-github-action@v1
  id: junie
  with:
    junie_api_key: ${{ secrets.JUNIE_API_KEY }}

- name: Use outputs
  if: steps.junie.outputs.should_skip != 'true'
  run: |
    echo "Branch: ${{ steps.junie.outputs.branch_name }}"
    echo "Title: ${{ steps.junie.outputs.junie_title }}"
    if [ "${{ steps.junie.outputs.pr_url }}" != "" ]; then
      echo "PR created: ${{ steps.junie.outputs.pr_url }}"
    fi
```

### Required Permissions

The action requires specific GitHub token permissions to perform its operations. Configure these in your workflow:

```yaml
permissions:
  contents: write      # Required to create branches, make commits, and push changes
  pull-requests: write # Required to create PRs, add comments to PRs, and update PR status
  issues: write        # Required to add comments to issues and update issue metadata
  checks: read         # Optional: only needed for CI failure analysis with MCP servers
```

**Minimal permissions** for `silent_mode` (read-only operations):
```yaml
permissions:
  contents: read
  pull-requests: read
  issues: read
```

### GitHub Token Considerations

#### Default Token Limitation

When using the default `github.token` (automatically provided by GitHub Actions), there's an important security limitation you should be aware of:

**⚠️ Pull requests and changes created using the default token will NOT trigger other workflow runs.**

For example, if you use the default token:
```yaml
- uses: JetBrains/junie-github-action@main
  with:
    junie_api_key: ${{ secrets.JUNIE_API_KEY }}
    # No custom_github_token specified - uses default github.token
```

When Junie creates a PR or pushes commits, the following workflows will **NOT be triggered**:
- Workflows with `pull_request` or `pull_request_target` triggers
- Workflows with `pull_request_review` or `pull_request_review_comment` triggers
- Workflows with `push` triggers (on the new branch)
- Workflows with `create` triggers (for new branches)

**Why?** This is a GitHub security feature designed to prevent accidental infinite workflow loops.

#### Using a Custom Token

To allow Junie's changes to trigger other workflows, provide a custom token:

```yaml
- uses: JetBrains/junie-github-action@v1
  with:
    junie_api_key: ${{ secrets.JUNIE_API_KEY }}
    custom_github_token: ${{ secrets.CUSTOM_GITHUB_TOKEN }}
```

**Custom token options:**

##### 1. Personal Access Token (PAT)

- Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Grant `repo` scope (or fine-grained: Contents, Pull requests, Issues permissions)
- Store in repository secrets as `CUSTOM_GITHUB_TOKEN`

##### 2. GitHub App Token (Recommended for organizations)

GitHub App tokens

**Setup steps:**

a. **Install Your App:**
   - Click "Install App" in the sidebar
   - Select your repository

b. **Add secrets to repository:**
   - Go to repository Settings → Secrets and variables → Actions
   - Add `APP_ID` with your App ID
   - Add `APP_PRIVATE_KEY` with the entire contents of the `.pem` file

e. **Use in workflow:**

```yaml
jobs:
  junie:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4

      # Generate token from GitHub App
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      # Use the generated token
      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          custom_github_token: ${{ steps.app-token.outputs.token }}
```

## Use Cases & Examples

### Interactive Development

**Use Case**: Get AI assistance directly in issues and PRs

```yaml
# Trigger with @junie-agent mentions
on:
  issue_comment:
    types: [created]
```

**Example**: Comment `@junie-agent implement a validation function for email addresses` on an issue, and Junie will create a PR with the implementation.

---

### Conflict Resolution

**Use Case**: Resolve merge conflicts manually or automatically

#### Option 1: Manual Trigger (Recommended)

Simply comment on a PR with conflicts:

```markdown
@junie-agent resolve conflicts
```

Junie will automatically detect the conflicts and resolve them. **No additional configuration needed** - works with your basic Junie workflow.

#### Option 2: Automatic Detection

For automatic conflict detection without manual trigger, add this workflow:

```yaml
name: Resolve Conflicts

on:
  push:
  workflow_dispatch:
    inputs:
      prNumber:
        description: "PR number"
        required: true

jobs:
  resolve-conflicts:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          resolve_conflicts: true
```

**How it works**:
- **Manual**: Ask Junie anytime via `@junie-agent resolve conflicts` comment
- **Automatic**: With `resolve_conflicts: true`, Junie monitors pushes and auto-resolves conflicts in open PRs where pushed branch is the base branch.

**Note**: The `resolve_conflicts: true` setting is only needed for automatic conflict detection. For manual resolution via comments, your basic Junie workflow is sufficient.

---

### Silent Mode (Output-Only)

**Use Case**: Get Junie analysis without creating comments, branches, or commits

```yaml
name: Code Analysis

on:
  pull_request_review_comment:
    types: [created]

jobs:
  analyze:
    if: contains(github.event.comment.body, '@junie-agent')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4

      - uses: JetBrains/junie-github-action@v1
        id: junie
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          silent_mode: true

      - name: Process Junie Output
        if: steps.junie.outputs.should_skip != 'true'
        run: |
          echo "Title: ${{ steps.junie.outputs.junie_title }}"
          echo "Summary: ${{ steps.junie.outputs.junie_summary }}"

          # Send to external system, generate custom report, etc.
          curl -X POST https://your-api.com/analysis \
            -d "title=${{ steps.junie.outputs.junie_title }}" \
            -d "summary=${{ steps.junie.outputs.junie_summary }}"
```

**When to use**:
- Custom reporting workflows
- External CI/CD integration
- Code analysis without modification
- Testing Junie responses before applying changes

---

### Single Comment Mode

**Use Case**: Keep GitHub conversations clean by updating a single comment instead of creating multiple comments

```yaml
name: Junie

on:
  issue_comment:
    types: [created]
  issues:
    types: [opened]

jobs:
  junie:
    if: contains(github.event.comment.body, '@junie-agent') || contains(github.event.issue.body, '@junie-agent')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          use_single_comment: true
```

**How it works**:
- On first run, Junie creates a new comment with progress and results
- On subsequent runs, Junie finds and updates the same comment instead of creating new ones
- **Workflow-specific**: Each workflow maintains its own comment, allowing multiple Junie workflows in the same issue/PR
- **For PR review comments** (code-level): Searches only within the specific comment thread, preventing cross-thread updates

---

### CI Failure Analysis

**Use Case**: Investigate and fix failing tests or checks

```yaml
name: Fix Failed Checks

on:
  workflow_run:
    workflows: ["<your CI workflow name>"]
    types: [completed]

jobs:
  analyze-failures:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      checks: read
    steps:
      - uses: actions/checkout@v4
      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          allowed_mcp_servers: mcp_github_checks_server
          use_single_comment: true
          prompt: |
            CI check ${{ github.event.workflow_run.name }} failed.
            Investigate workflow file and logs to suggest fixes.
            Use the get_pr_failed_checks_info MCP tool to analyze error logs.
```

**How it works**: The MCP GitHub Checks Server extracts error logs from failed runs, and Junie analyzes them to suggest or implement fixes.

---

### Label-Based Triggers

**Use Case**: Trigger Junie by adding a label to issues

```yaml
on:
  issues:
    types: [labeled]

jobs:
  junie:
    if: github.event.label.name == 'auto-fix'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          label_trigger: "auto-fix"
```

## Real-World Examples

### Respond to PR Comments

```markdown
**User comment on PR**: @junie-agent can you add error handling to the database connection?

**Junie response**:
- Analyzes the PR context
- Implements error handling
- Commits to the PR branch
- Comments with the commit link
```

### Auto-Fix Issues

```markdown
**Issue title**: Bug: Login form doesn't validate email format

**Issue body**: @junie-agent please fix this

**Junie action**:
- Creates branch `junie/issue-123`
- Implements email validation
- Creates PR with fix
- Comments on issue with PR link
```

### Resolve Merge Conflicts

#### Manual Resolution (Simple)
```markdown
**User comment on PR #42**: @junie-agent please resolve the merge conflicts

**Junie action**:
- Detects conflicts in the PR
- Merges main into feature branch
- Resolves conflicts intelligently
- Pushes resolved changes
- Comments with success status
```

#### Automatic Resolution (With Configuration)
```markdown
**Scenario**: Push to main creates conflict in PR #42

**Junie action** (with `resolve_conflicts: true`):
- Automatically detects conflict after push
- Triggers workflow without manual intervention
- Merges main into feature branch
- Resolves conflicts intelligently
- Pushes resolved changes
- Comments on PR with success status
```

## How It Works

1. **Trigger Detection**: The action detects triggers (mentions, labels, assignments, or prompts)
2. **Validation**: Verifies permissions and checks if the actor is human (when applicable - see Security Considerations)
3. **Branch Management**: Creates or checks out the appropriate working branch
4. **Task Preparation**: Converts GitHub context into a Junie-compatible task
5. **MCP Setup**: Configures enabled MCP servers for enhanced capabilities
6. **Junie Execution**: Runs Junie CLI with the prepared task
7. **Result Processing**: Analyzes changes and determines the action (commit, PR, or comment)
8. **Feedback**: Updates GitHub with results, PR links, and commit information

## Security Considerations

- **Permission Validation**: Only users with write access can trigger Junie (by default)
- **Human Actor Verification**: Blocks bot-initiated workflows to prevent loops
  - ✅ **Applies when**:
    - Interactive events (issue comments, PR comments, PR reviews) with trigger phrase/label/assignee
    - **AND** no custom `prompt` input is provided
  - ❌ **Does NOT apply when**:
    - Custom `prompt` input is provided (allows automation to trigger Junie)
    - Automated workflows (scheduled, workflow_dispatch, workflow_run)
    - Push events
  - ⚠️ **Important**: When using custom prompts or automated workflows, ensure proper workflow permissions and conditions to prevent unintended execution
- **Token Management**: Supports custom GitHub tokens for enhanced security
- **Artifact Retention**: Working directory uploaded as artifact (7-day retention)

## Troubleshooting

### Action Doesn't Trigger

- Verify the trigger phrase matches (default: `@junie-agent`)
- Check workflow `if:` condition includes your event type
- Ensure actor has write permissions
- Review GitHub Actions logs for validation errors

### Junie Fails to Execute

- Verify `JUNIE_API_KEY` secret is set correctly
- Check Junie version compatibility (`junie_version` input)
- Review uploaded artifacts for Junie working directory logs
- Ensure runner has internet access for API calls

### No PR Created

- Check if branch already exists (may push to existing branch)
- Verify `create_new_branch_for_pr` setting for PR scenarios
- Review action outputs for `ACTION_TO_DO` value
- Ensure there are actual file changes to commit
