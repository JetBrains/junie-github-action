# Junie GitHub Action

A powerful GitHub Action that integrates [Junie](https://www.jetbrains.com/junie/) (JetBrains' AI coding agent) into your GitHub workflows to automate code changes, issue resolution, PR management, and conflict resolution. Junie can understand your codebase, implement fixes, review changes, and respond to developer requests directly in issues and pull requests.

## 📑 Table of Contents

- [Features](#features)
- [Quickstart](#quickstart)
  - [Prerequisites](#prerequisites)
  - [Basic Setup](#basic-setup)
- [Jira Integration](#jira-integration)
- [Cookbook](#cookbook)
- [Configuration](#configuration)
  - [Input Parameters](#input-parameters)
  - [Outputs](#outputs)
  - [Required Permissions](#required-permissions)
  - [GitHub Token Considerations](#github-token-considerations)
- [How It Works](#how-it-works)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Features

- **Interactive Code Assistant**: Responds to @junie-agent mentions in comments, issues, and PRs
- **Issue Resolution**: Automatically implements solutions for GitHub issues
- **PR Management**: Reviews code changes and implements requested modifications
- **Inline Code Reviews**: Create code review comments with GitHub suggestions directly on PR diffs
- **Conflict Resolution**: Resolve merge conflicts via `@junie-agent` comment or automatic detection
- **Minor PR Fixes**: Quickly implement small changes in PRs using `@junie-agent minor-fix [instruction]`
- **CI Failure Analysis**: Investigates failed checks and suggests fixes using MCP integration
- **Flexible Triggers**: Activate via mentions, assignees, labels, or custom prompts
- **Smart Branch Management**: Context-aware branch creation and management
- **Silent Mode**: Run analysis-only workflows without comments or git operations
- **Single Comment Mode**: Update a single comment instead of creating multiple comments for each run (per workflow)
- **Comprehensive Feedback**: Updates via GitHub comments with links to PRs and commits
- **Rich Job Summaries**: Beautiful markdown reports in GitHub Actions with execution details
- **Attachment Support**: Automatically downloads and processes attachments from GitHub issues and PRs
- **Security-First Design**: Built-in sanitization against prompt injection and automated redaction of sensitive information like GitHub tokens
- **MCP Extensibility**: Integrate custom Model Context Protocol servers for enhanced capabilities
- **Runs on Your Infrastructure**: Executes entirely on your GitHub runners

## Quickstart

### Prerequisites

1. **Junie API Key**: Obtain from [JetBrains Junie](https://junie.labs.jb.gg/)
2. **Repository Permissions**: Admin access to configure secrets and workflows

### Basic Setup

#### Manual Setup

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
        uses: JetBrains/junie-github-action@v0
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
   - Comment `@junie-agent minor-fix rename variable x to y` in a PR to make quick adjustments

## Jira Integration

🔗 **Want to trigger Junie from Jira?** Check out the [Jira Integration Guide](docs/JIRA_INTEGRATION.md) to automatically implement features and fixes based on Jira issues.

## Cookbook

📚 **Looking for practical examples?** Check out the [Cookbook](COOKBOOK.md) for real-world recipes including:

- **Automated Code Review** - Structured PR reviews for security, performance, and code quality
- **Sync Code → Documentation** - Auto-update docs when code changes
- **Fix Failing CI Tests** - Diagnose and fix test failures automatically
- **Security Audit for Secrets** - Scan commits for accidentally committed credentials
- **Automatic Merge Conflict Resolution** - Automatically resolve conflicts when base branch changes

Each recipe includes complete workflows, prompts, and configuration examples you can copy and adapt.

## Configuration

### Input Parameters

#### Trigger Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `trigger_phrase` | Phrase to activate Junie in comments/issues. Redacted in Junie's output and replaced with "the assistant" to prevent self-triggering loops. | `@junie-agent` |
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
| `prompt` | Custom instructions for Junie. Special values: `code-review` for structured PR reviews, `fix-ci` for CI failure analysis, `minor-fix` for quick PR adjustments. See [Cookbook](COOKBOOK.md) for examples. | - |
| `junie_version` | Junie CLI version to install. Use `latest` for the most recent version. | `849.19.0` |
| `model` | Model to use for the primary agent. Available: `claude-sonnet-4-6`, `claude-opus-4-6`, `gpt-5-2025-08-07`, `gpt-5.2-codex`, `gpt-5.2-2025-12-11`, `gemini-3-pro-preview`, `gemini-3-flash-preview`, `grok-4-1-fast-reasoning`, `claude-opus-4-5-20251101` | - |
| `junie_work_dir` | Working directory for Junie files | `/tmp/junie-work` |
| `junie_guidelines_filename` | Filename of the guidelines file (should be in `<project-root>/.junie` dir) | `guidelines.md` |
| `allowed_mcp_servers` | Comma-separated list of MCP servers to use (e.g., `mcp_github_checks_server`). Note: inline comment server is automatically enabled for PRs. | - |

**Inline Arguments**: You can pass custom Junie CLI arguments directly in comments, issues, or custom prompts using `junie-args:` syntax. These arguments take priority over workflow inputs.

```markdown
@junie-agent fix the bug
junie-args: --model=claude-opus-4-5
```

**Available MCP Servers**:
- `mcp_github_checks_server`: Analyze failed GitHub Actions checks and provide detailed error information
- `mcp_github_inline_comment_server`: Create inline code review comments with GitHub suggestions on PRs (automatically enabled for pull requests)

**Example configuration**:
```yaml
- uses: JetBrains/junie-github-action@v0
  with:
    junie_api_key: ${{ secrets.JUNIE_API_KEY }}
    allowed_mcp_servers: "mcp_github_checks_server"
    model: "claude-opus-4-5-20251101"  # Optional: specify which model to use
```

**Note**: The `mcp_github_inline_comment_server` is automatically enabled for `pull_request` events - no manual configuration needed.

#### Advanced Features

| Input | Description | Default |
|-------|-------------|---------|
| `resolve_conflicts` | Enable automatic conflict detection (not needed for manual `@junie-agent` resolution) | `false` |
| `silent_mode` | Run Junie without comments, branch creation, or commits - only prepare data and output results | `false` |
| `use_single_comment` | Update a single comment for all runs instead of creating new comments each time | `false` |
| `attach_github_context_to_custom_prompt` | Attach GitHub context (PR/issue info, commits, reviews, etc.) when using custom prompt | `false` |

#### Jira Integration

| Input | Description | Default |
|-------|-------------|---------|
| `jira_base_url` | Jira instance base URL (e.g., `https://your-company.atlassian.net`) | - |
| `jira_email` | Jira account email for API authentication | - |
| `jira_api_token` | Jira API token for authentication | - |
| `jira_transition_in_progress` | Jira transition ID for "In Progress" status | `21` |
| `jira_transition_in_review` | Jira transition ID for "In Review" status | `31` |

For detailed setup instructions, see the [Jira Integration Guide](docs/JIRA_INTEGRATION.md).

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
| `custom_junie_args` | Custom Junie arguments extracted from prompt/comment (e.g., `--model=value`) |
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
  checks: read         # Optional: needed for CI failure analysis with MCP servers
  actions: read        # Optional: needed for CI failure analysis with MCP servers (to fetch logs)
```

**Minimal permissions** for `silent_mode` (read-only operations):
```yaml
permissions:
  contents: read
  pull-requests: read
  issues: read
```

#### Repository Settings for PR Creation

If you're using the default `github.token` and want Junie to create pull requests, you must enable this in your repository settings:

1. Go to **Settings** → **Actions** → **General**
2. Scroll to the **Workflow permissions** section
3. Check **"Allow GitHub Actions to create and approve pull requests"**

Without this setting enabled, the action will fail when attempting to create PRs, even with correct `pull-requests: write` permissions in the workflow.

### GitHub Token Considerations

#### Default Token Limitation

When using the default `github.token` (automatically provided by GitHub Actions), there's an important security limitation you should be aware of:

**⚠️ Pull requests and changes created using the default token will NOT trigger other workflow runs.**

For example, if you use the default token:
```yaml
- uses: JetBrains/junie-github-action@v0
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

**⚠️ The default token CANNOT modify workflow files in `.github/workflows/` directory.**

If Junie attempts to modify, create, or delete files in the `.github/workflows/` directory, GitHub will reject the push with an error:

```
refusing to allow a GitHub App to create or update workflow without `workflows` permission
```


**To enable workflow file modifications**, you must use a custom token (PAT or GitHub App token) with the `workflow` scope as described below.

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
- **If Junie needs to modify workflow files:** Also grant `workflow` scope (or fine-grained: Workflows read and write permission)
- Store in repository secrets as `CUSTOM_GITHUB_TOKEN`

##### 2. GitHub App Token (Recommended for organizations)

GitHub App tokens provide fine-grained, auditable access control.

**Setup steps:**

a. **Create and configure the GitHub App:**
   - Set repository permissions: Contents (read/write), Pull requests (read/write), Issues (read/write)
   - **If Junie needs to modify workflow files:** Also enable Workflows (read/write) permission

b. **Install your app to the repository**

c. **Add secrets to repository:**
   - Go to repository Settings → Secrets and variables → Actions
   - Add `APP_ID` with your App ID
   - Add `APP_PRIVATE_KEY` with the entire contents of the `.pem` file

d. **Use in workflow:**

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
4. **Task Preparation**: Converts GitHub context into a Junie-compatible task, applying security sanitization to user-submitted content to prevent prompt injection
5. **Attachment Processing**: Automatically downloads attachments from issues, PRs, and comments
   - Downloaded files are made available to Junie for analysis and context
6. **MCP Setup**: Configures enabled MCP servers for enhanced capabilities
   - **Checks Server**: Analyze CI failures if explicitly enabled
   - **Inline Comment Server**: Automatically enabled for PR code review suggestions
7. **Junie Execution**: Runs Junie CLI with the prepared task and connected MCP tools
8. **Result Processing**: Analyzes changes, determines the action (commit, PR, or comment), and sanitizes Junie's output to redact tokens and prevent self-triggering
9. **Feedback**: Updates GitHub with results, PR links, and commit information

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
- **Content Sanitization**: Protects against prompt injection by removing malicious instructions hidden in HTML comments, invisible characters, image alt text, link titles, and obfuscated entities
- **Output Redaction**: Automatically redacts GitHub tokens and replaces trigger phrases (replaced with "the assistant") in Junie's responses to prevent accidental token exposure and self-triggering loops
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
