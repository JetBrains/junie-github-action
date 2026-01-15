import {
    isCodeReviewWorkflowDispatchEvent,
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
import {DEFAULT_CODE_REVIEW_PROMPT} from "../../constants/github";
import {Octokits} from "../api/client";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {validateInputSize} from "../validation/input-size";
import {downloadAttachmentsAndRewriteText} from "./attachment-downloader";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";
import {FetchedData} from "../api/queries";
import {CliInput} from "./types/junie";

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
    octokit: Octokits
) {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    const customPrompt = context.inputs.prompt || undefined;
    let junieCLITask: CliInput = {}

    if (context.inputs.resolveConflicts || isReviewOrCommentHasResolveConflictsTrigger(context) || isResolveConflictsWorkflowDispatchEvent(context)) {
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

        const isCodeReview = isCodeReviewWorkflowDispatchEvent(context);
        console.log(`[DEBUG] isCodeReview: ${isCodeReview}`);

        if (issue && isCodeReview) {
            console.log(`[DEBUG] Using DEFAULT_CODE_REVIEW_PROMPT`);
            // For code reviews, we use the legacy task string for now to avoid JSON parsing issues with large objects
            // and ensure compatibility with the Junie CLI version.
            const instructions = context.inputs.prompt || DEFAULT_CODE_REVIEW_PROMPT;
            const promptText = await formatter.generatePrompt(context, fetchedData, instructions, true);
            console.log(`[DEBUG] Generated prompt length: ${promptText.length}`);
            junieCLITask.task = await getValidatedTextTask(promptText, "task");
        } else {
            console.log(`[DEBUG] Using custom prompt or fallback task`);
            // Fallback to legacy task string for other events (like issue_comment "fix this")
            const promptText = await formatter.generatePrompt(context, fetchedData, customPrompt, context.inputs.attachGithubContextToCustomPrompt);
            console.log(`[DEBUG] Generated prompt length: ${promptText.length}`);
            junieCLITask.task = await getValidatedTextTask(promptText, "task");
        }
    }

    if (!junieCLITask.task && !junieCLITask.mergeTask && !junieCLITask.issueTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    const taskJson = JSON.stringify(junieCLITask);
    core.setOutput(OUTPUT_VARS.JUNIE_JSON_TASK, taskJson);

    return junieCLITask;
}
