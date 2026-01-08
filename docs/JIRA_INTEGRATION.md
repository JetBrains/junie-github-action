# Jira Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on Jira issues

## How It Works

When a Jira issue is created or updated with a specific trigger (e.g., adding a label), Jira automation triggers a GitHub Actions workflow via `workflow_dispatch`. Junie then:

1. **Receives the Jira issue** details (key, summary, description)
2. **Transitions the issue to "In Progress"** automatically
3. **Implements the changes** based on the issue description
4. **Creates a pull request** with the changes
5. **Transitions the issue to "In Review"**
6. **Adds a comment** to the Jira issue with the PR link

## Setup

### 1. Configure Jira API Access

Create a Jira API token:

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a name (e.g., "Junie GitHub Integration")
4. Copy the generated token

### 2. Add GitHub Secrets

Add the following secrets to your GitHub repository:

- `JIRA_EMAIL`: Your Jira account email
- `JIRA_API_TOKEN`: The API token you created
- `JIRA_BASE_URL`: Your Jira instance URL (e.g., `https://your-company.atlassian.net`)

### 3. Configure Jira Transition IDs (Optional)

By default, the integration uses these transition IDs:
- **In Progress**: `21`
- **In Review**: `31`

These IDs may vary depending on your Jira workflow. To find your transition IDs:

```bash
curl -u EMAIL:API_TOKEN \
  "https://your-company.atlassian.net/rest/api/3/issue/YOUR-ISSUE-KEY/transitions" \
  | jq '.transitions[] | {id, name}'
```

Add custom transition IDs as GitHub secrets if needed:
- `JIRA_TRANSITION_IN_PROGRESS`
- `JIRA_TRANSITION_IN_REVIEW`

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
        uses: JetBrains/junie-github-action@v0
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          jira_base_url: ${{ secrets.JIRA_BASE_URL }}
          jira_email: ${{ secrets.JIRA_EMAIL }}
          jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
#          optional
#          jira_transition_in_progress: your value
#          jira_transition_in_review: your value
```

### 5. Configure Jira Automation

In Jira, create an automation rule:

1. **Trigger**: Issue created/updated, or Label added (e.g., "junie-agent")
2. **Action**: Send web request

**Web Request Configuration:**

- **URL**: `https://api.github.com/repos/{owner}/{repo}/actions/workflows/junie-jira.yml/dispatches`
- **Method**: POST
- **Headers**:
  ```
  Authorization: Bearer {{secrets.GITHUB_TOKEN}}
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

### Comments and Attachments Support

Junie will receive all comments and attachments from the Jira issue. This allows the AI to:
- Read user discussions and clarifications in comments
- Access screenshots, diagrams, and other files attached to the issue
- Better understand the context and requirements