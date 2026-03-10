# YouTrack Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on YouTrack issues.

## How It Works

The integration uses the [YouTrack Junie App](https://plugins.jetbrains.com/plugin/26849-junie?noRedirect=true) to dispatch GitHub Actions workflows directly from a YouTrack issue. There are two ways to trigger Junie:

- **Widget button:** Click **Run Junie** on the issue page.
- **Comment mention:** Add a comment starting with `@junie` (configurable). The app detects it automatically and passes the comment text as `trigger_comment`.

In both cases, the app sends the issue data to GitHub Actions, and Junie:

1. **Receives the YouTrack issue** details (ID, title, description, comments, and optional trigger comment)
2. **Posts a comment** to the YouTrack issue indicating that work has started
3. **Fetches attachments** from the issue via the YouTrack API and includes them in context
4. **Implements the changes** based on the issue description (or the trigger comment, if provided)
5. **Creates a pull request** with the changes (or commits directly to the branch)
6. **Updates the initial comment** on the YouTrack issue with the result (PR link or error details)

> **Tip:** If `trigger_comment` is provided (e.g., a comment like `@junie fix the login bug`), Junie treats it as the primary instruction and uses the issue details only as context.

## Setup

### 1. Create a YouTrack User for Junie (Recommended)

Creating a dedicated user for Junie allows comments posted by Junie to appear under a recognizable name, and enables `@junie` autocomplete in issue comments.

1. Go to **Administration → Access Management → Users**
2. Click **New User** and fill in:
   - **Login**: `junie`
   - **Full name**: `Junie`
   - **Email**: any valid address
3. Grant the user appropriate permissions (at minimum: read issues, create/update comments)
4. Log in as the new user (or use an admin token to impersonate), go to **Profile → Authentication → Permanent Tokens**
5. Click **New token**, name it (e.g., "Junie GitHub Integration"), select the `YouTrack` scope with read/write access to issues and comments
6. Copy the generated token

> If you prefer not to create a dedicated user, you can generate a token from your own profile instead.

### 2. Add GitHub Secrets

Add the following secret to your GitHub repository:

- `YOUTRACK_TOKEN`: The permanent token you created in step 1

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
      trigger_comment:
        description: 'Optional comment that triggered Junie (used as user instruction)'
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

1. Install the [YouTrack Junie App](https://plugins.jetbrains.com/plugin/26849-junie?noRedirect=true)
2. In your YouTrack project, go to **Apps → Junie → Settings** and configure:
   - **GitHub Token** (required): the personal access token with `workflow` permission.
   - **Trigger Name** (optional): the phrase that triggers Junie when a comment starts with it. Defaults to `@junie`. Change it to e.g. `/junie` if you prefer a slash command style.
3. In your YouTrack project, go to **Settings → Version Control** and add a GitHub VCS integration pointing to the target repository.

After setup, a **Run Junie** button will appear on every issue in the project. Clicking it dispatches the `junie-youtrack.yml` workflow with the issue data automatically.

> If your project has multiple GitHub repositories, go to **Settings → Apps → Junie Repositories** to select which ones are available for Junie.
