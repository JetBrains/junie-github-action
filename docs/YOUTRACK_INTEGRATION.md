# YouTrack Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on YouTrack issues.

## How It Works

The integration uses the [YouTrack Junie App](https://plugins.jetbrains.com/plugin/youtrack-junie-app) (available in JetBrains Marketplace) to dispatch GitHub Actions workflows directly from a YouTrack issue. Once the app is configured, a **Run Junie** button appears on every issue. When clicked, the app sends the issue data to GitHub Actions, and Junie:

1. **Receives the YouTrack issue** details (ID, title, description, comments, attachments)
2. **Posts a comment** to the YouTrack issue indicating work has started
3. **Implements the changes** based on the issue description
4. **Creates a pull request** with the changes
5. **Adds a comment** to the YouTrack issue with the result (PR link or error details)

## Setup

### 1. Create a YouTrack Permanent Token

1. Open your YouTrack instance and go to your profile settings
2. Navigate to **Authentication** → **Permanent Tokens**
3. Click **New token**, give it a name (e.g., "Junie GitHub Integration"), and select the required scopes (at minimum: `YouTrack` → read/write issues and comments)
4. Copy the generated token

### 2. Add GitHub Secrets

Add the following secret to your GitHub repository:

- `YOUTRACK_TOKEN`: The permanent token you created

### 3. Create GitHub Workflow

Create `.github/workflows/junie-youtrack.yml`:

```yaml
name: Junie YouTrack Integration

on:
  workflow_dispatch:
    inputs:
      action:
        description: 'Action type'
        default: 'youtrack_event'
        required: true
        type: string
      issue_id:
        description: 'YouTrack issue ID (e.g., PROJ-123)'
        required: true
        type: string
      issue_url:
        description: 'Full URL to the YouTrack issue'
        required: false
        type: string
      issue_title:
        description: 'YouTrack issue summary/title'
        required: true
        type: string
      issue_description:
        description: 'YouTrack issue description'
        required: false
        type: string
      issue_comments:
        description: 'YouTrack issue comments (plain text)'
        required: false
        type: string
      issue_attachments:
        description: 'YouTrack issue attachments (JSON array of {url, filename?, mimeType?})'
        required: false
        type: string
      youtrack_base_url:
        description: 'YouTrack instance base URL (e.g., https://youtrack.example.com)'
        required: true
        type: string

jobs:
  junie:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    if: ${{ inputs.action == 'youtrack_event' }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Junie
        uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          youtrack_token: ${{ secrets.YOUTRACK_TOKEN }}
```

### 4. Install and Configure the YouTrack Junie App

The YouTrack Junie App handles the workflow dispatch automatically — no custom scripting required.

1. Open **YouTrack → Administration → Apps** and find **Junie** in the JetBrains Marketplace, then click **Install**.
2. In your YouTrack project, go to **Apps -> Junie -> Settings** and enter the GitHub token from step 2.
3. In your YouTrack project, go to **Settings → Version Control** and add a GitHub VCS integration pointing to the target repository.

After setup, a **Run Junie** button will appear on every issue in the project. Clicking it dispatches the `junie-youtrack.yml` workflow with the issue data automatically.

> If your project has multiple GitHub repositories, go to **Settings → Apps → Junie Repositories** to select which ones are available for Junie.