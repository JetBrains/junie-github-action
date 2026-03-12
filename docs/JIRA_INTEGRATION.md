# Jira Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on Jira issues

## How It Works

When a Jira issue is created or updated with a specific trigger (e.g., adding a label), Jira automation triggers a GitHub Actions workflow via `workflow_dispatch`. Junie then:

1. **Receives the Jira issue** details (key, summary, description)
2. **Posts a comment** to the Jira issue indicating that work has started
3. **Implements the changes** based on the issue description
4. **Creates a pull request** with the changes
5. **Updates the initial comment** on the Jira issue with the result (PR link or summary)

## Setup

### 1. Create a Jira User for Junie (Recommended)

Creating a dedicated user for Junie allows comments posted by Junie to appear under a recognizable name, and enables `@junie` autocomplete in issue comments.

1. Go to **Administration → User Management → Users**
2. Click **Create user** and fill in:
   - **Email**: any valid address (e.g., `junie@your-company.com`)
   - **Full name**: `Junie`
   - **Username**: `junie`
3. Grant the user appropriate project permissions (at minimum: browse projects, add comments)
4. Log in as the new user, go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens), and create an API token
5. Use this user's email and token for the `JIRA_EMAIL` and `JIRA_API_TOKEN` secrets

> If you prefer not to create a dedicated user, generate an API token from your own Atlassian account instead.

### 2. Configure Jira API Access

Create a Jira API token:

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a name (e.g., "Junie GitHub Integration")
4. Copy the generated token

### 3. Add GitHub Secrets

Add the following secrets to your GitHub repository:

- `JIRA_EMAIL`: Your Jira account email
- `JIRA_API_TOKEN`: The API token you created
- `JIRA_BASE_URL`: Your Jira instance URL (e.g., `https://your-company.atlassian.net`)

### 4. Create GitHub Workflow

Create `.github/workflows/junie-jira.yml`:

```yaml
name: Junie Jira Integration

on:
  workflow_dispatch:
    inputs:
      action:
        description: 'Action type'
        default: 'jira_event'
        required: true
        type: string
      issue_key:
        description: 'Jira issue key (e.g., TEST-1)'
        required: true
        type: string
      issue_summary:
        description: 'Jira issue summary/title'
        required: true
        type: string
      issue_description:
        description: 'Jira issue description'
        required: false
        type: string
      issue_comments:
        description: 'Jira issue comments'
        required: false
      issue_attachments:
        description: 'Jira issue attachments'
        required: false
      trigger_comment:
        description: 'Comment that triggered Junie (used as user instruction)'
        required: false
        type: string

jobs:
  junie:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    if: ${{ inputs.action == 'jira_event' }}

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
          jira_base_url: ${{ secrets.JIRA_BASE_URL }}
          jira_email: ${{ secrets.JIRA_EMAIL }}
          jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
```

### 5. Configure Jira Automation

Create two automation rules in Jira — one triggered by a label, one triggered by an `@junie` comment.

#### Rule 1: Label Trigger

1. **Trigger**: Issue created/updated, or Label added (e.g., "junie-agent")
2. **Action**: Send web request

**Web Request Configuration:**

- **URL**: `https://api.github.com/repos/{owner}/{repo}/actions/workflows/junie-jira.yml/dispatches`
- **Method**: POST
- **Headers**:
  ```
  Authorization: Bearer YOUR_GITHUB_TOKEN
  Content-Type: application/json
  ```
- **Body** (Custom data):
  ```json
  {
    "ref": "main",
    "inputs": {
      "action": "jira_event",
      "issue_key": "{{issue.key}}",
      "issue_summary": "{{issue.summary.jsonEncode}}",
      "issue_description": "{{issue.description.jsonEncode}}",
      "issue_comments": "[{{#issue.comments}}{\"author\":\"{{author.displayName.jsonEncode}}\",\"body\":\"{{body.jsonEncode}}\",\"created\":\"{{created}}\"}{{^last}},{{/}}{{/}}]",
      "issue_attachments": "[{{#attachment}}{\"filename\":\"{{filename.jsonEncode}}\",\"mimeType\":\"{{mimeType}}\",\"size\":{{size}},\"content\":\"{{content}}\"}{{^last}},{{/}}{{/}}]"
    }
  }
  ```

#### Rule 2: Comment Trigger (`@junie`)

This rule lets you tag Junie in any issue comment to ask it to perform a specific task.

1. **Trigger**: Work item commented
2. **Comment type**: Comment is the main action
3. **Condition**: `{{comment.body}}` contains `@junie`
4. **Action**: Send web request (same URL and headers as Rule 1)

**Body** (Custom data):
```json
{
  "ref": "main",
  "inputs": {
    "action": "jira_event",
    "issue_key": "{{issue.key}}",
    "issue_summary": "{{issue.summary.jsonEncode}}",
    "issue_description": "{{issue.description.jsonEncode}}",
    "issue_comments": "[{{#issue.comments}}{\"author\":\"{{author.displayName.jsonEncode}}\",\"body\":\"{{body.jsonEncode}}\",\"created\":\"{{created}}\"}{{^last}},{{/}}{{/}}]",
    "issue_attachments": "[{{#attachment}}{\"filename\":\"{{filename.jsonEncode}}\",\"mimeType\":\"{{mimeType}}\",\"size\":{{size}},\"content\":\"{{content}}\"}{{^last}},{{/}}{{/}}]",
    "trigger_comment": "{{comment.body.jsonEncode}}"
  }
}
```

When `trigger_comment` is provided, Junie treats it as the primary instruction and uses the issue details as context only.

### Comments and Attachments Support

Junie will receive all comments and attachments from the Jira issue. This allows the AI to:
- Read user discussions and clarifications in comments
- Access screenshots, diagrams, and other files attached to the issue
- Better understand the context and requirements

#### Handling Special Characters

**Automatic Sanitization**: The action automatically handles unescaped special characters (newlines, quotes, etc.) that may not be properly encoded by Jira's `jsonEncode`. This means the basic configuration above will work in most cases without additional modifications.

**Optional Optimization** (for better reliability): If you experience issues or want to ensure maximum compatibility, you can add explicit character replacement in your Jira automation:

```json
{
  "ref": "main",
  "inputs": {
    "action": "jira_event",
    "issue_key": "{{issue.key}}",
    "issue_summary": "{{issue.summary.jsonEncode}}",
    "issue_description": "{{issue.description.jsonEncode}}",
    "issue_comments": "[{{#issue.comments}}{\"author\":\"{{author.displayName.jsonEncode}}\",\"body\":\"{{body.jsonEncode.replace(\"\\n\",\" \").replace(\"\\\"\",\"\")}}\",\"created\":\"{{created}}\"}{{^last}},{{/}}{{/}}]",
    "issue_attachments": "[{{#attachment}}{\"filename\":\"{{filename.jsonEncode}}\",\"mimeType\":\"{{mimeType}}\",\"size\":{{size}},\"content\":\"{{content}}\"}{{^last}},{{/}}{{/}}]"
  }
}
```

The `.replace("\\n"," ").replace("\\"","")` addition removes newlines and quotes that could break JSON parsing.