import {
    GitHubContext,
    isIssueCommentEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent
} from "../context";
import * as core from "@actions/core";
import {BranchInfo} from "../operations/branch";
import {isReviewOrCommentHasTrigger} from "../validation/trigger";
import {OUTPUT_VARS} from "../../constants/environment";
import {RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP} from "../../constants/github";
import {Octokits} from "../api/client";
import {GitHubPromptFormatter} from "./prompt-formatter";
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

function getTriggerTime(context: GitHubContext): string | undefined {
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
    context: GitHubContext,
    branchInfo: BranchInfo,
    octokit: Octokits
) {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    const useStructuredPrompt = context.inputs.useStructuredPrompt;


    const customPrompt = context.inputs.prompt || undefined;
    let junieCLITask: CliInput = {}

    if (context.inputs.resolveConflicts || isReviewOrCommentHasTrigger(context, RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP)) {
        junieCLITask.mergeTask = {branch: branchInfo.prBaseBranch || branchInfo.baseBranch}
    } else if (useStructuredPrompt) {
        const newFormatter = new NewGitHubPromptFormatter();
        let fetchedData: FetchedData = {};
        const triggerTime = getTriggerTime(context);

        // Fetch appropriate data
        if (context.isPR && context.entityNumber) {
            fetchedData = await fetcher.fetchPullRequestData(owner, repo, context.entityNumber, triggerTime);
        } else if (context.entityNumber) {
            fetchedData = await fetcher.fetchIssueData(owner, repo, context.entityNumber, triggerTime);
        }

        // Generate prompt using new formatter
        const promptText = newFormatter.generatePrompt(context, fetchedData, customPrompt);
        junieCLITask.task = await getValidatedTextTask(promptText, "structured-prompt");
    } else {
        const formatter = new GitHubPromptFormatter();
        // Use old formatter logic for backward compatibility
        junieCLITask.task = await prepareTaskWithOldFormatter(context, fetcher, formatter, customPrompt);
    }

    if (!junieCLITask.task && !junieCLITask.mergeTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    core.setOutput(OUTPUT_VARS.JUNIE_JSON_TASK, JSON.stringify(junieCLITask));

    return junieCLITask;
}

async function prepareTaskWithOldFormatter(
    context: GitHubContext,
    fetcher: GraphQLGitHubDataFetcher,
    formatter: GitHubPromptFormatter,
    customPrompt?: string
): Promise<string | undefined> {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const triggerTime = getTriggerTime(context);
    let junieTask: string | undefined = customPrompt

    // Handle issue comment (not on PR)
    if (isIssueCommentEvent(context) && !context.isPR) {
        const issueNumber = context.payload.issue.number;

        // Single GraphQL query for all issue data
        const issueData = await fetcher.fetchIssueData(owner, repo, issueNumber, triggerTime);

        const promptText = formatter.formatIssueCommentPrompt(
            issueData,
            {
                body: context.payload.comment.body,
                author: context.payload.comment.user.login
            },
            customPrompt
        );
        junieTask = await getValidatedTextTask(promptText, "issue-comment");
    }

    // Handle issue event (opened/edited)
    if (isIssuesEvent(context)) {
        const issueNumber = context.payload.issue.number;

        // Single GraphQL query for all issue data
        const issueData = await fetcher.fetchIssueData(owner, repo, issueNumber, triggerTime);

        const promptText = formatter.formatIssuePrompt(issueData, customPrompt);
        junieTask = await getValidatedTextTask(promptText, "issue");
    }

    // Handle PR comment
    if (isIssueCommentEvent(context) && context.isPR) {
        const pullNumber = context.payload.issue.number;

        // Single GraphQL query for all PR data - much faster than 5 REST calls!
        const prData = await fetcher.fetchPullRequestData(owner, repo, pullNumber, triggerTime);

        const promptText = formatter.formatPullRequestCommentPrompt(
            prData,
            {
                body: context.payload.comment.body,
                author: context.payload.comment.user.login
            },
            customPrompt
        );
        junieTask = await getValidatedTextTask(promptText, "pr-comment");
    }

    // Handle PR review
    if (isPullRequestReviewEvent(context)) {
        const pullNumber = context.payload.pull_request.number;
        const reviewId = context.payload.review.id;

        // Single GraphQL query for all PR data
        const prData = await fetcher.fetchPullRequestData(owner, repo, pullNumber, triggerTime);

        // Find the specific review from the fetched reviews
        const review = prData.pullRequest.reviews.nodes.find(r => r.databaseId === reviewId);
        if (!review) {
            throw new Error(`Review ${reviewId} not found in PR ${pullNumber}`);
        }

        const promptText = formatter.formatPullRequestReviewPrompt(
            prData,
            review,
            customPrompt
        );
        junieTask = await getValidatedTextTask(promptText, "pr-review");
    }

    // Handle PR review comment
    if (isPullRequestReviewCommentEvent(context)) {
        const pullNumber = context.payload.pull_request.number;

        // Single GraphQL query for all PR data
        const prData = await fetcher.fetchPullRequestData(owner, repo, pullNumber, triggerTime);

        const promptText = formatter.formatPullRequestReviewCommentPrompt(
            prData,
            {
                body: context.payload.comment.body,
                author: context.payload.comment.user.login
            },
            customPrompt
        );
        junieTask = await getValidatedTextTask(promptText, "pr-review-comment");
    }

    // Handle PR event (opened/edited)
    if (isPullRequestEvent(context)) {
        const pullNumber = context.payload.pull_request.number;

        // Single GraphQL query for all PR data
        const prData = await fetcher.fetchPullRequestData(owner, repo, pullNumber, triggerTime);

        const promptText = formatter.formatPullRequestPrompt(prData, customPrompt);
        junieTask = await getValidatedTextTask(promptText, "pull-request");
    }

    return junieTask;
}
