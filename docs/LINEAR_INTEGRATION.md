# Linear Integration for Junie GitHub Action

This integration allows Junie to automatically implement features and fixes based on Linear issues.

## How It Works

The integration uses a bridge (e.g., Cloudflare Worker) to catch Linear webhooks and dispatch GitHub Actions workflows. 

1. **Trigger**: Пользователь пишет комментарий в задаче Linear (например, `@junie исправь баг`).
2. **Webhook**: Linear отправляет вебхук на URL моста. Чтобы указать целевой репозиторий напрямую, добавьте его в URL: `https://...workers.dev/?repo=owner/repo`.
3. **Dispatch**: Мост вызывает событие `workflow_dispatch` в указанном GitHub-репозитории.
4. **Junie Execution**: 
    - Junie получает данные задачи (ID, заголовок, описание, комментарии).
    - Junie пишет стартовый комментарий в Linear со ссылкой на GitHub Actions run.
    - Junie вносит изменения и создает Pull Request.
    - Junie обновляет свой комментарий в Linear результатом (ссылка на PR или текст ошибки).

> **Tip:** If `trigger_comment` is provided, Junie treats it as the primary instruction and uses the issue details only as context.

## Setup

### 1. Create a Linear API Key

1. В Linear перейдите в **Settings → Account → Security & Access**.
   *   *(Если вы не видите этого раздела, возможно, администратор вашей организации запретил создание персональных API-ключей для участников. В этом случае обратитесь к администратору)*.
2. Прокрутите вниз до раздела **Personal API keys**.
3. Введите название ключа и нажмите **Create API key**.
4. Скопируйте ключ (он начинается с `lin_api_...`).
   *   ⚠️ **Важно:** Сохраните ключ сразу, так как он больше не будет показан.

### 2. Add GitHub Secret

Add the following secret to your GitHub repository:

- `LINEAR_API_KEY`: The API key you created in step 1.

### 3. Create GitHub Workflow

Create `.github/workflows/junie-linear.yml` in your repository:

```yaml
name: Junie Linear Integration

on:
  workflow_dispatch:
    inputs:
      action:
        description: "Action type (linear_event)"
        required: true
        default: "linear_event"
      issue_id:
        description: "Linear issue UUID"
        required: true
      issue_identifier:
        description: "Linear issue identifier (e.g. ENG-123)"
        required: true
      issue_url:
        description: "Link to Linear issue"
        required: false
      issue_title:
        description: "Issue title"
        required: true
      issue_description:
        description: "Issue description"
        required: false
      issue_comments:
        description: "Issue comments as flat text"
        required: false
      trigger_comment:
        description: "Comment that triggered Junie"
        required: false

jobs:
  junie:
    name: Junie Process Linear Issue
    runs-on: ubuntu-latest
    if: ${{ github.event.inputs.action == 'linear_event' }}
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Junie
        uses: JetBrains/junie-github-action@v1
        with:
          junie_api_key: ${{ secrets.JUNIE_API_KEY }}
          linear_api_key: ${{ secrets.LINEAR_API_KEY }} # КРИТИЧНО: Убедитесь, что этот секрет передан!
```

### 4. Configure the Bridge

You need a bridge (like a Cloudflare Worker) that listens to Linear webhooks and calls the GitHub API.

#### Multi-repo Support and Filtering

Вы можете подключить **любое количество репозиториев** к одному проекту или разным проектам в Linear. Для этого создайте несколько вебхуков в Linear, каждый со своим целевым репозиторием в URL.

**Specifying the Repository:**
Include the repository in the Webhook URL as a query parameter:
`https://junie-linear-bridge.mariia-fadeeva.workers.dev/?repo=OWNER/REPO`

**How to avoid duplicate PRs in different repos?**
Чтобы Junie не создавала PR во всех репозиториях одновременно:
1. **Упоминание репозитория**: Мост (Bridge) может поддерживать фильтрацию по тексту комментария. Например, если вы напишете `@junie [repo-a] исправь баг`, мост отправит запрос только в `repo-a`.
2. **Логика упоминаний**: По умолчанию Junie запускается только если комментарий содержит `@junie`. Вы можете настроить мост так, чтобы он искал специфичные теги или проверял контекст.
3. **Отдельные команды/проекты**: Самый надежный способ — привязывать разные вебхуки к разным командам (Teams) или проектам (Projects) в Linear через настройки самого вебхука. Таким образом, событие из команды "Frontend" уйдет только в репозиторий фронтенда.

**Examples:**
- For Repo A: `https://...workers.dev/?repo=my-org/repo-a`
- For Repo B: `https://...workers.dev/?repo=my-org/repo-b`

Alternatively, the bridge can use internal mapping logic (e.g., mapping a Linear Team ID to a GitHub repository).

**Workflow Dispatch:**
The bridge sends a `POST` request to:
`https://api.github.com/repos/{OWNER}/{REPO}/actions/workflows/junie-linear.yml/dispatches`

With the following payload:

```json
{
  "ref": "main",
  "inputs": {
    "action": "linear_event",
    "issue_id": "{linear issue UUID}",
    "issue_identifier": "{ENG-123}",
    "issue_url": "{link to issue}",
    "issue_title": "{issue title}",
    "issue_description": "{issue description}",
    "issue_comments": "{all comments text}",
    "trigger_comment": "{comment that triggered Junie}"
  }
}
```

Ensure the bridge uses a GitHub token with `workflow` scope.
