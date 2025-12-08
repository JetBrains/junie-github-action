# Junie GitHub Action

A powerful GitHub Action that integrates [Junie](https://www.jetbrains.com/junie/) (JetBrains' AI coding agent) into your GitHub workflows to automate code changes, issue resolution, PR management, and conflict resolution. Junie can understand your codebase, implement fixes, review changes, and respond to developer requests directly in issues and pull requests.

## 📑 Table of Contents

- [Features](#features)
- [Quickstart](#quickstart)
  - [Prerequisites](#prerequisites)
  - [Basic Setup](#basic-setup)
- [Cookbook](#cookbook)
- [Configuration](#configuration)
  - [Input Parameters](#input-parameters)
  - [Outputs](#outputs)
  - [Required Permissions](#required-permissions)
  - [GitHub Token Considerations](#github-token-considerations)
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
- Use `@v0` for the latest v0.x.x version (pre-release)
- Use `@v0.1.0` for a specific version (pinned - no automatic updates)
- Use `@main` for the latest development version (not recommended for production)

3. Start using Junie:
   - Comment `@junie-agent help me fix this bug` on an issue
   - Mention `@junie-agent review this change` in a PR
   - Add the `junie` label to trigger automatically

## Cookbook

📚 **Looking for practical examples?** Check out the [Cookbook](COOKBOOK.md) for real-world recipes including:

- **Automated Code Review** - Structured PR reviews for security, performance, and code quality
- **Sync Code → Documentation** - Auto-update docs when code changes
- **Fix Failing CI Tests** - Diagnose and fix test failures automatically
- **Security Audit for Secrets** - Scan commits for accidentally committed credentials
- **Dependency Update Assistant** - Review and adapt to breaking changes in dependencies

Each recipe includes complete workflows, prompts, and configuration examples you can copy and adapt.

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
- uses: JetBrains/junie-github-action@v0
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
- uses: JetBrains/junie-github-action@v0
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
      - uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          custom_github_token: ${{ steps.app-token.outputs.token }}
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
