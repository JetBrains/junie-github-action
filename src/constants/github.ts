// ============================================================================
// GitHub Actions Bot Configuration
// ============================================================================

export const GITHUB_ACTIONS_BOT = {
    login: "github-actions[bot]",
    id: 41898282, // Official GitHub Actions bot ID
    type: "Bot" as const,
} as const;

// ============================================================================
// Actions and Triggers
// ============================================================================

export const RESOLVE_CONFLICTS_ACTION = "resolve-conflicts";

export const RESOLVE_CONFLICTS_TRIGGER_PHRASE = "resolve conflicts"

export const RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP = new RegExp(RESOLVE_CONFLICTS_TRIGGER_PHRASE, 'i')

export const CODE_REVIEW_ACTION = "code-review";

export const CODE_REVIEW_TRIGGER_PHRASE_REGEXP = new RegExp(CODE_REVIEW_ACTION, 'i')

export const JIRA_EVENT_ACTION = "jira_event";

export const WORKING_BRANCH_PREFIX = "junie/";

export const DEFAULT_TRIGGER_PHRASE = "@junie-agent";

// ============================================================================
// Templates and Messages
// ============================================================================

export const DEFAULT_CODE_REVIEW_PROMPT = `
Your task is to:
1. Review the Pull Request changes
2. Output summary following the template below

2. Review ONLY these unstaged changes against the Core Review Areas below, prioritizing repository style/guidelines adherence and avoiding overcomplication.
3. You may open files or search the project to understand context. Do NOT run tests, build, or make any modifications.
4. Terminate by calling the 'answer' tool with 'full_answer' containing a single bullet list of comments. Do not include headers, summaries, or any other text. Do NOT call 'submit'.

### Core Review Areas

1. **Adherence with this repository style and guidelines**
   - Naming, formatting, and package structure consistency with existing code and modules.
   - Reuse of existing utilities/patterns; avoiding introduction of new dependencies.

2. **Avoiding overcomplications**
   - Avoid new abstractions, frameworks, premature generalization, or unnecessarily complicated solutions.
   - Avoid touching of unrelated files.
   - Avoid unnecessary indirection (wrappers, flags, configuration) and ensure straightforward control flow.
   - Do not allow duplicate logic.

### If obviously applicable to the CHANGED lines only
- Security: newly introduced unsafe input handling, command execution, or data exposure.
- Performance: unnecessary allocations/loops/heavy work on UI thread introduced by the change.
- Error handling: swallowing exceptions or deviating from existing error-handling patterns.

### Output Format
- Provide a single bullet list of comments.
- Each bullet MUST reference the exact file and added line range, e.g., \`Foo.kt:120–123 (Bar.baz): {concise comment}\`.
- Comment ONLY on lines added in this diff (\`+\` lines). Do not comment on pre-existing code.
- Keep it concise (15–25 words per comment). No praise, questions, or speculation; omit low-impact nits.
- If unsure whether a comment applies, omit it. If no feedback is warranted, respond \`LGTM\` only.
- For small changes, max 3 comments; medium 6–8; large 8–12.
`;

/**
 * Creates a hidden marker for identifying Junie comments from a specific workflow.
 * This HTML comment is invisible to users but allows finding Junie comments
 * even when different tokens or bots are used.
 *
 * Including workflow name prevents different Junie workflows from overwriting
 * each other's comments in the same issue/PR.
 *
 * @param workflowName - Name of the GitHub Actions workflow (from GITHUB_WORKFLOW env var)
 * @returns HTML comment marker unique to this workflow
 */
export function createJunieCommentMarker(workflowName: string): string {
    // Sanitize workflow name to be safe in HTML comments (remove -- and >)
    const sanitized = workflowName.replace(/--/g, '-').replace(/>/g, '');
    return `<!-- junie-bot-comment:${sanitized} -->`;
}

export const INIT_COMMENT_BODY = "Hey, it's Junie by JetBrains! I started working..."

export const PR_BODY_TEMPLATE = (junieBody: string, issueId?: number) => `
 ## 📌 Hey! This PR was made for you with Junie, the coding agent by JetBrains **Early Access Preview**

It's still learning, developing, and might make mistakes. Please make sure you review the changes before you accept them.
We'd love your feedback — join our Discord to share bugs, ideas: [here](https://jb.gg/junie/github).

${issueId ? `- 🔗 **Issue:** Fixes: #${issueId}` : ""}

### 📊 Junie Summary:
${junieBody}
`

export const PR_TITLE_TEMPLATE = (junieTitle: string) =>
    `[Junie]: ${junieTitle}`

export const COMMIT_MESSAGE_TEMPLATE = (junieTitle: string, issueId?: number) =>
    `${issueId ? `[issue-${issueId}]\n\n` : ""}${junieTitle}`;

// ============================================================================
// Feedback Comments
// ============================================================================

export const SUCCESS_FEEDBACK_COMMENT = "Junie successfully finished!"

export const ERROR_FEEDBACK_COMMENT_TEMPLATE = (details: string, jobLink: string) => `Junie is failed!

Details: ${details}

${jobLink}
`

export const PR_CREATED_FEEDBACK_COMMENT_TEMPLATE = (prLink: string) => `${SUCCESS_FEEDBACK_COMMENT}\n PR link: [${prLink}](${prLink})`

export const MANUALLY_PR_CREATE_FEEDBACK_COMMENT_TEMPLATE = (createPRLink: string) => `${SUCCESS_FEEDBACK_COMMENT}\n\nYou can create a PR manually: [Create Pull Request](${createPRLink})`

export const COMMIT_PUSHED_FEEDBACK_COMMENT_TEMPLATE = (commitSHA: string, junieTitle: string, junieBody: string) => `${SUCCESS_FEEDBACK_COMMENT}\n\n ${junieTitle}\n${junieBody} Commit sha: ${commitSHA}`

export const SUCCESS_FEEDBACK_COMMENT_WITH_RESULT = (junieTitle: string, junieBody: string) => `${SUCCESS_FEEDBACK_COMMENT}\n\nResult: ${junieTitle} \n ${junieBody}`
