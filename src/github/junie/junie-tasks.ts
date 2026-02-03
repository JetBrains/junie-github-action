import {
    isFixCIEvent,
    isFixCodeReviewEvent,
    isIssueCommentEvent,
    isIssuesEvent,
    isMinorFixEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
    JunieExecutionContext
} from "../context";
import * as core from "@actions/core";
import {BranchInfo} from "../operations/branch";
import {isReviewOrCommentHasResolveConflictsTrigger} from "../validation/trigger";
import {OUTPUT_VARS} from "../../constants/environment";
import {createCodeReviewPrompt, createFixCIFailuresPrompt, createMinorFixPrompt, MINOR_FIX_ACTION} from "../../constants/github";
import {Octokits} from "../api/client";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {downloadAttachmentsAndRewriteText} from "./attachment-downloader";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";
import {FetchedData} from "../api/queries";
import {CliInput} from "./types/junie";
import {generateMcpToolsPrompt} from "../../mcp/mcp-prompts";
import {junieArgsToString} from "../../utils/junie-args-parser";

async function getValidatedTextTask(text: string): Promise<string> {
    // Download attachments and rewrite URLs in the text
    return await downloadAttachmentsAndRewriteText(text)
}

/**
 * Extracts the user's request text from a comment that triggered the minor-fix action.
 * The request is the text that follows "minor-fix" in the comment.
 * For example: "minor-fix rename variable foo to bar" -> "rename variable foo to bar"
 */
function extractMinorFixRequest(context: JunieExecutionContext): string | undefined {
    let commentBody: string | undefined;

    if (isIssueCommentEvent(context) || isPullRequestReviewCommentEvent(context)) {
        commentBody = context.payload.comment.body;
    } else if (isPullRequestReviewEvent(context)) {
        commentBody = context.payload.review.body || undefined;
    }

    if (!commentBody) {
        return undefined;
    }

    // Match "minor-fix" (case insensitive) and capture everything after it
    const match = commentBody.match(new RegExp(`${MINOR_FIX_ACTION}\\s*(.*)`, 'is'));
    if (match && match[1]) {
        const request = match[1].trim();
        return request.length > 0 ? request : undefined;
    }

    return undefined;
}

function getTriggerTime(context: JunieExecutionContext): string | undefined {
    if (isIssueCommentEvent(context)) {
        return context.payload.comment.created_at;
    } else if (isIssuesEvent(context)) {
        return context.payload.issue.updated_at;
    } else if (isPullRequestReviewEvent(context)) {
        return context.payload.review.submitted_at || undefined;
    } else if (isPullRequestReviewCommentEvent(context)) {
        return context.payload.comment.created_at;
    } else if (isPullRequestEvent(context)) {
        return context.payload.pull_request.updated_at;
    }
    return undefined;
}

export async function prepareJunieTask(
    context: JunieExecutionContext,
    branchInfo: BranchInfo,
    octokit: Octokits,
    enabledMcpServers: string[] = []
) {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    const customPrompt = context.inputs.prompt || undefined;
    let junieCLITask: CliInput = {}
    let customJunieArgs: string[] = [];

    if (context.inputs.resolveConflicts || isReviewOrCommentHasResolveConflictsTrigger(context)) {
        junieCLITask.mergeTask = {branch: branchInfo.prBaseBranch || branchInfo.baseBranch}
    } else {
        const formatter = new NewGitHubPromptFormatter();
        let fetchedData: FetchedData = {};
        const triggerTime = getTriggerTime(context);

        // Fetch appropriate data
        if (context.isPR && context.entityNumber) {
            fetchedData = await fetcher.fetchPullRequestData(owner, repo, context.entityNumber, triggerTime);
        } else if (context.entityNumber) {
            fetchedData = await fetcher.fetchIssueData(owner, repo, context.entityNumber, triggerTime);
        }

        const issue = fetchedData.pullRequest || fetchedData.issue;

        const isCodeReview = isFixCodeReviewEvent(context)
        const isFixCI = isFixCIEvent(context)
        const isMinorFix = isMinorFixEvent(context)

        let finalCustomPrompt = customPrompt;
        if (issue && isCodeReview) {
            const branchName = branchInfo.prBaseBranch || branchInfo.baseBranch;
            const diffPoint = context.isPR ? String(context.entityNumber) : branchName;
            finalCustomPrompt = createCodeReviewPrompt(diffPoint);
            console.log(`Using CODE REVIEW prompt for diffPoint: ${diffPoint}`);
        } else if (isFixCI) {
            // Fix CI can trigger with or without an associated PR/issue (e.g., workflow_run failure on a branch)
            const branchName = branchInfo.prBaseBranch || branchInfo.baseBranch;
            const diffPoint = context.isPR && context.entityNumber ? String(context.entityNumber) : branchName;
            finalCustomPrompt = createFixCIFailuresPrompt(diffPoint);
            console.log(`Using FIX-CI prompt for diffPoint: ${diffPoint}`);
            console.log(`Fix-CI prompt preview (first 200 chars): ${finalCustomPrompt.substring(0, 200)}`);
        } else if (isMinorFix) {
            const branchName = branchInfo.prBaseBranch || branchInfo.baseBranch;
            const diffPoint = context.isPR && context.entityNumber ? String(context.entityNumber) : branchName;
            // Extract user request from comment (text after "minor-fix")
            const userRequest = extractMinorFixRequest(context);
            finalCustomPrompt = createMinorFixPrompt(diffPoint, userRequest);
            console.log(`Using MINOR-FIX prompt for diffPoint: ${diffPoint}, userRequest: ${userRequest || '(none)'}`);
        }

        const promptResult = await formatter.generatePrompt(context, fetchedData, finalCustomPrompt, context.inputs.attachGithubContextToCustomPrompt);
        let promptText = promptResult.prompt;
        customJunieArgs = promptResult.customJunieArgs;

        // Log extracted custom junie args if any
        if (customJunieArgs.length > 0) {
            console.log(`Extracted custom junie args: ${customJunieArgs.join(' ')}`);
        }

        // Append MCP tools information if any MCP servers are enabled
        const mcpToolsPrompt = generateMcpToolsPrompt(enabledMcpServers);
        if (mcpToolsPrompt) {
            promptText = promptText + mcpToolsPrompt;
        }

        junieCLITask.task = await getValidatedTextTask(promptText);
    }

    if (!junieCLITask.task && !junieCLITask.mergeTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    core.setOutput(OUTPUT_VARS.JUNIE_JSON_TASK, JSON.stringify(junieCLITask));

    // Output custom junie args as a string for use in action.yml
    const customJunieArgsString = junieArgsToString(customJunieArgs);
    core.setOutput(OUTPUT_VARS.CUSTOM_JUNIE_ARGS, customJunieArgsString);

    return junieCLITask;
}
