import {
    isResolveConflictsWorkflowDispatchEvent,
    JunieExecutionContext,
    isIssueCommentEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent
} from "../context";
import * as core from "@actions/core";
import {BranchInfo} from "../operations/branch";
import {
    isReviewOrCommentHasCodeReviewTrigger,
    isReviewOrCommentHasResolveConflictsTrigger
} from "../validation/trigger";
import {OUTPUT_VARS} from "../../constants/environment";
import {CODE_REVIEW_ACTION, createCodeReviewPrompt} from "../../constants/github";
import {Octokits} from "../api/client";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {validateInputSize} from "../validation/input-size";
import {downloadAttachmentsAndRewriteText} from "./attachment-downloader";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";
import {FetchedData} from "../api/queries";
import {CliInput} from "./types/junie";
import {generateMcpToolsPrompt} from "../../mcp/mcp-prompts";

async function getValidatedTextTask(text: string, taskType: string): Promise<string> {
    // Download attachments and rewrite URLs in the text
    const textWithLocalAttachments = await downloadAttachmentsAndRewriteText(text);
    validateInputSize(textWithLocalAttachments, taskType);
    return textWithLocalAttachments
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

        // Check if prompt contains CODE_REVIEW_ACTION phrase or if comment/review has code-review trigger
        const isCodeReviewInPrompt = customPrompt?.includes(CODE_REVIEW_ACTION);
        const isCodeReviewInComment = isReviewOrCommentHasCodeReviewTrigger(context);
        const isCodeReview = isCodeReviewInPrompt || isCodeReviewInComment;

        let promptText: string;
        if (issue && isCodeReview) {
            // Use default code review prompt when code-review trigger is detected
            const branchName = branchInfo.prBaseBranch || branchInfo.baseBranch;
            const codeReviewPrompt = createCodeReviewPrompt(branchName);
            promptText = await formatter.generatePrompt(context, fetchedData, codeReviewPrompt, true);
        } else {
            promptText = await formatter.generatePrompt(context, fetchedData, customPrompt, context.inputs.attachGithubContextToCustomPrompt);
        }

        // Append MCP tools information if any MCP servers are enabled
        const mcpToolsPrompt = generateMcpToolsPrompt(enabledMcpServers);
        if (mcpToolsPrompt) {
            promptText = promptText + mcpToolsPrompt;
        }

        junieCLITask.task = await getValidatedTextTask(promptText, "task");
    }

    if (!junieCLITask.task && !junieCLITask.mergeTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    core.setOutput(OUTPUT_VARS.JUNIE_JSON_TASK, JSON.stringify(junieCLITask));

    return junieCLITask;
}
