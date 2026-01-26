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

export function createCodeReviewPrompt(diffPoint: string): string {
    const diffCommand = `gh pr diff ${diffPoint}`
    return `
Your task is to:
1. Read the Pull Request diff by using \`${diffCommand} | grep \"^diff --git\" \`. Do not write the diff to file.
2. Review the downloaded diff according to the criteria below
3. For each specific finding, use the 'post_inline_review_comment' tool (if available) to provide feedback directly on the code.
4. Once all findings are posted (or if the tool is unavailable), call the 'answer' tool with your review as a bullet point list in the 'full_answer' field.

Additional instructions:
1. Review ONLY the changed lines against the Core Review Areas below, prioritizing repository style/guidelines adherence and avoiding overcomplication.
2. You may open files or search the project to understand context. Do NOT run tests, build, or make any modifications.
3. Do NOT call 'submit'.

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
- If the 'post_inline_review_comment' tool is available, use it for each specific finding.
- **Use the tool parameters correctly**:
    - \`filePath\`: The relative path to the file.
    - \`lineNumber\`: The line (or end of range) where the comment applies.
    - \`startLineNumber\`: Use this for multi-line comments to cover a range.
    - \`commentBody\`: Your explanation. Use the \`\`\`suggestion syntax here for code changes.
- Once all inline comments are posted, call the 'answer' tool with your review as a bullet point list in the 'full_answer' field.
- If the tool is NOT available, use the fallback format in 'full_answer' only: -\`File.ts:Line: Comment\`.
- Comment ONLY on lines added in this diff (\`+\` lines). Do not comment on pre-existing code.
- Keep it concise (15–25 words per comment). No praise, questions, or speculation; omit low-impact nits.
- If unsure whether a comment applies, omit it. If no feedback is warranted, answer \`LGTM\` only .
- For small changes, max 3 comments; medium 6–8; large 8–12.
`;
}

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
