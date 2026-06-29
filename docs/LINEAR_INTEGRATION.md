# Linear Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on Linear issues. You trigger it by mentioning `@junie-agent` in a Linear issue or comment — Junie then picks up the issue, implements the change, opens a pull request, and reports the result back on the Linear issue.

## How It Works

When you mention `@junie-agent` in a Linear issue description or comment, a hosted bridge dispatches the `junie-linear.yml` workflow in your connected repository. Junie then:

1. **Receives the Linear issue** details (ID, title, description, comments, and the trigger comment)
2. **Posts a comment** to the Linear issue indicating that work has started
3. **Implements the changes** based on the issue description
4. **Creates a pull request** with the changes
5. **Updates the initial comment** on the Linear issue with the result (PR link or error message)

> **Tip:** The text of the triggering comment is treated as Junie's primary instruction; the issue details are used as context.

## Setup

For an end user, the setup is six steps.

### 1. Install the GitHub App

Install the **Junie GitHub App** into the repository where Junie should work:

```text
https://github.com/apps/junie-linear/installations/new
```

This grants the bridge permission to trigger workflows and open pull requests in that repository.

### 2. Add the workflow file

Add `.github/workflows/junie-linear.yml` to the repository (on your default branch):

```yaml
name: Junie Linear Integration

on:
  workflow_dispatch:
    inputs:
      action:
        description: "Action type (linear_event)"
        required: true
        default: "linear_event"
        type: string
      issue_id:
        description: "Linear issue UUID"
        required: true
        type: string
      issue_identifier:
        description: "Linear issue identifier (e.g. ENG-123)"
        required: false
        type: string
      issue_url:
        description: "Link to Linear issue"
        required: false
        type: string
      issue_title:
        description: "Issue title"
        required: true
        type: string
      issue_description:
        description: "Issue description"
        required: false
        type: string
      issue_comments:
        description: "Issue comments as flat text"
        required: false
        type: string
      trigger_comment:
        description: "Comment that triggered Junie"
        required: false
        type: string

jobs:
  junie:
    name: Junie Process Linear Issue
    runs-on: ubuntu-latest
    if: ${{ inputs.action == 'linear_event' }}
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
        uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          linear_api_key: ${{ secrets.LINEAR_API_KEY }}
```

### 3. Add the required secrets

Add these secrets to your GitHub repository (**Settings → Secrets and variables → Actions**):

- `JUNIE_API_KEY` — your Junie API key.
- `LINEAR_API_KEY` — a Linear Personal API key. Junie uses it to post comments back to the Linear issue and to query Linear via MCP.

To create the Linear key:

1. In Linear, go to **Settings → Account → Security & Access** → **Personal API keys**.
   *(If you don't see this section, your organization admin may have disabled personal API keys for members.)*
2. Click **Create API key**, give it a name (e.g. "Junie GitHub Integration"), and copy the generated key (it starts with `lin_api_...`).
   ⚠️ Save it immediately — it will not be shown again.

> [!IMPORTANT]
> **Don't forget to pass `linear_api_key`!** Even after adding the secret, you must forward it to the action via the `with` block (as shown in the workflow above). Without it you'll see `⚠️ Linear API key not found`, and Junie won't be able to post results back to Linear.

### 4. Connect Linear

Open the setup link in your browser:

```text
https://linear-github-bridge.mariia-fadeeva.workers.dev/oauth/start?repo=OWNER/REPO
```

where `OWNER/REPO` is your GitHub repository (e.g. `my-org/my-repo`).

### 5. Authorize Linear

Approve access for the Junie Linear app. The bridge stores the authorization and sets up the webhook for you automatically.

### 6. Done

When you see the **`Junie bridge connected`** screen, the integration is ready.

## Using It

In a Linear issue **description** or a **comment**, mention:

```text
@junie-agent
```

Add your instruction after the mention (e.g. `@junie-agent fix the failing login test`). The bridge then triggers the `junie-linear.yml` workflow in the connected repository, and Junie reports progress back on the Linear issue.

> **Note:** `@junie-agent` is the trigger phrase the bridge looks for. Events without it are ignored.

## Multi-repo Support

To use Junie across multiple repositories, connect each one separately: install the GitHub App on that repository, add the workflow file and secrets, then run the **Connect Linear** step (step 4) with that repository in the `repo` parameter. You can scope each Linear webhook to a specific Team or Project so events reach the right repository.
