// ============================================================================
// GitHub Actions Bot Configuration
// ============================================================================

export const GITHUB_ACTIONS_BOT = {
    login: "github-actions[bot]",
    id: 41898282, // Official GitHub Actions bot ID
    type: "Bot" as const,
} as const;

export const JUNIE_AGENT = {
    login: "junie-agent",
    id: 247260674, // Junie agent GitHub account ID
    email: "247260674+junie-agent@users.noreply.github.com",
} as const;

// ============================================================================
// Actions and Triggers
// ============================================================================

export const RESOLVE_CONFLICTS_ACTION = "resolve-conflicts";

export const RESOLVE_CONFLICTS_TRIGGER_PHRASE = "resolve conflicts"

export const RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP = new RegExp(RESOLVE_CONFLICTS_TRIGGER_PHRASE, 'i')

export const CODE_REVIEW_ACTION = "code-review";

export const CODE_REVIEW_TRIGGER_PHRASE_REGEXP = new RegExp(CODE_REVIEW_ACTION, 'i')

export const FIX_CI_ACTION = "fix-ci";

export const FIX_CI_TRIGGER_PHRASE_REGEXP = new RegExp(FIX_CI_ACTION, 'i');

export const MINOR_FIX_ACTION = "minor-fix";

export const MINOR_FIX_TRIGGER_PHRASE_REGEXP = new RegExp(MINOR_FIX_ACTION, 'i');

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
4. Once all findings are posted (or if the tool is unavailable), submit with your review as a bullet point list.

Additional instructions:
1. Review ONLY the changed lines against the Core Review Areas below, prioritizing repository style/guidelines adherence and avoiding overcomplication.
2. You may open files or search the project to understand context. Do NOT run tests, build, or make any modifications.
3. Do NOT create any new files. Do NOT commit or push any changes. This is a read-only code review and you don't have write access to the repository.

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
- Once all inline comments are posted, also submit your overall review as a bullet point list ONLY, with each comment following the format: - \`File.ts:Line: Comment\`. Do NOT include any summary, introduction, conclusion, notes, or any other text—ONLY the bullet points.
- Comment ONLY on the actual modifications in this diff. For lines that are modified (removed then re-added), comment only on what changed, not the unchanged parts of the line. Never comment on pre-existing code.
- Ensure that your suggestions are not already implemented, or equivalent to existing code.
- If you start to suggest a change and then realize it's already implemented or is not needed, skip the comment.
- Keep it concise (15–25 words per comment). No praise, questions, or speculation; omit low-impact nits.
- If unsure whether a comment applies, omit it. If no feedback is warranted, submit \`LGTM\` only .
- Only make comments of medium or high impact and only if you have high confidence in your findings.
- For small changes, max 3 comments; medium 6–8; large 8–12.
`;
}

export function createFixCIFailuresPrompt(diffPoint: string): string {
    const diffCommand = `gh pr diff ${diffPoint}`
    return `
Your task is to analyze CI failures and suggest fixes WITHOUT implementing them. Follow these steps:

### Steps to follow
1. Gather Information
   - Use the 'get_pr_failed_checks_info' tool to retrieve information about failed CI/CD checks.
   - Read the Pull Request diff by using \`${diffCommand} | grep "^diff --git"\`. Do not write the diff to file.

2. If NO failed checks were found:
   - Submit ONLY the following message:
   ---
   ## ✅ CI Status
   
   No failed checks found for this PR. All CI checks have passed or are still running.
   ---

3. If failed checks WERE found, analyze each failure:
   - Open and explore relevant source files to understand the context
   - Do NOT run tests, build, or make any modifications to the codebase.
   - Identify the failing step and error message. 
   - Determine the root cause (test failure, build error, linting issue, timeout, flaky test, etc.)
   - Correlate the error with changes in the PR diff. 
   - Determine if the failure is related to the PR diff or a pre-existing issue
   - Do not use the 'post_inline_review_comment' tool. Suggest changes only as shown in the template below.

4. Submit your analysis using EXACTLY the output format described below. You MUST always follow this template structure precisely, do not add an extra section or change the format.

### Output Format
---
## 🔴 CI Failure Analysis

**Failed Check:** [check name]
**Failed Step:** [step name if identifiable]
**Error Type:** [test failure / build error / lint error / timeout / other]

### Error Details
\`\`\`
[relevant error message/stack trace - keep concise]
\`\`\`

### Root Cause
[1-3 sentences explaining why this failed]

### Correlation with PR Changes
[Explain which files/changes in this PR likely caused the failure, or state if it appears unrelated]

## 🔧 Suggested Fix

### What needs to change
[Clear description of the fix approach]

### Files to modify
- \`File.ts:Line:\`: [what needs to change and why]

### Code changes
\`\`\`[language]
// Suggested code snippet or pseudocode
\`\`\`
---
`;
}

export function createMinorFixPrompt(diffPoint: string, userRequest?: string): string {
    const diffCommand = `gh pr diff ${diffPoint}`
    const userRequestSection = userRequest 
        ? `\n### User Request\nThe user has specifically requested: "${userRequest}"\nFocus on addressing this request while following all the guidelines below.\n`
        : '';
    const gatherInfoUserRequestNote = userRequest
        ? `\n   - Focus specifically on understanding what "${userRequest}" means in the context of this PR. Identify the relevant files, functions, or code sections that relate to this request.`
        : '';
    
    return `
Your task is to make a minor fix to this Pull Request based on the user's request.
${userRequestSection}
### Steps to follow
1. Gather Information
   - Read the Pull Request diff by using \`${diffCommand} | grep "^diff --git"\`. Do not write the diff to file.
   - Understand the context of the changes and what the PR is trying to accomplish.${gatherInfoUserRequestNote}

2. Implement the Fix
   - Make the requested changes to the codebase.
   - Keep changes minimal and focused on the specific request.
   - Follow the existing code style and conventions in the repository.
   - Do NOT make unrelated changes or "improvements" beyond what was requested.

3. Validation
   - Ensure your changes compile/build successfully.
   - Run relevant tests if applicable.
   - Verify the fix addresses the user's request.

### Guidelines
- **Scope**: Only make changes directly related to the user's request. Do not refactor or "improve" unrelated code.
- **Style**: Match the existing code style, naming conventions, and patterns in the repository.
- **Safety**: Be conservative with changes. When in doubt, make the smaller change.
- **Testing**: If you modify logic, ensure existing tests still pass. Add tests only if explicitly requested.

### Output
Submit a brief summary of the changes you made and why they address the user's request.

IMPORTANT: Do NOT commit or push changes. The system will handle all git operations (staging, committing, and pushing) automatically.
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

/**
 * Important note about git operations to be added to all prompts.
 * Reminds the AI not to commit or push changes as the system handles it automatically.
 */
export const GIT_OPERATIONS_NOTE = "\n\nIMPORTANT: Do NOT commit or push changes. The system will handle all git operations (staging, committing, and pushing) automatically.";

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

export const COMMIT_MESSAGE_TEMPLATE = (junieTitle: string, issueId?: number, actor?: string, actorEmail?: string) => {
    const baseMessage = `${issueId ? `[issue-${issueId}]\n\n` : ""}${junieTitle}`;

    // Add co-author if actor information is provided
    if (actor && actorEmail) {
        return `${baseMessage}\n\nCo-authored-by: ${actor} <${actorEmail}>`;
    }

    return baseMessage;
};

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
