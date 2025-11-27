import {
    GitHubContext,
    isIssueCommentEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent
} from "../context";
import {JunieTask} from "./types/junie";
import * as core from "@actions/core";
import {BranchInfo} from "../operations/branch";
import {isReviewOrCommentHasTrigger} from "../validation/trigger";
import {OUTPUT_VARS} from "../../constants/environment";
import {RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP} from "../../constants/github";
import {Octokits} from "../api/client";
import {GitHubPromptFormatter} from "./prompt-formatter";
import {validateInputSize} from "../validation/input-size";
import {downloadAttachmentsAndRewriteText} from "./attachment-downloader";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";

async function setValidatedTextTask(junieTask: JunieTask, text: string, taskType: string): Promise<void> {
    // Download attachments and rewrite URLs in the text
    const textWithLocalAttachments = await downloadAttachmentsAndRewriteText(text);
    const newText = (junieTask.textTask?.text || "") + "\n" + textWithLocalAttachments;
    validateInputSize(newText, taskType);
    junieTask.textTask = {text: newText};
}

export async function prepareJunieTask(
    context: GitHubContext,
    branchInfo: BranchInfo,
    octokit: Octokits
) {
    const junieTask: JunieTask = {}
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    // Create fetcher and formatter instances
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    const formatter = new GitHubPromptFormatter();

    if (context.inputs.prompt) {
        await setValidatedTextTask(junieTask, context.inputs.prompt, "user-prompt");
    }

    // Handle issue comment (not on PR)
    if (isIssueCommentEvent(context) && !context.isPR) {
        const issueNumber = context.payload.issue.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        // Single GraphQL query for all issue data
        const {issue, timeline} = await fetcher.fetchIssueData(owner, repo, issueNumber);

        const promptText = formatter.formatIssueCommentPrompt(
            issue,
            timeline,
            commentBody,
            commentAuthor
        );
        await setValidatedTextTask(junieTask, promptText, "issue-comment");
    }

    // Handle issue event (opened/edited)
    if (isIssuesEvent(context)) {
        const issueNumber = context.payload.issue.number;

        // Single GraphQL query for all issue data
        const {issue, timeline} = await fetcher.fetchIssueData(owner, repo, issueNumber);

        const promptText = formatter.formatIssuePrompt(issue, timeline);
        await setValidatedTextTask(junieTask, promptText, "issue");
    }

    // Handle PR comment
    if (isIssueCommentEvent(context) && context.isPR) {
        const pullNumber = context.payload.issue.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        // Single GraphQL query for all PR data - much faster than 5 REST calls!
        const {issue, timeline, reviews, prDetails, changedFiles} = await fetcher.fetchPullRequestData(
            owner,
            repo,
            pullNumber
        );

        const promptText = formatter.formatPullRequestCommentPrompt(
            issue,
            timeline,
            reviews,
            commentBody,
            commentAuthor,
            prDetails,
            changedFiles
        );
        await setValidatedTextTask(junieTask, promptText, "pr-comment");
    }

    // Handle PR review
    if (isPullRequestReviewEvent(context)) {
        const pullNumber = context.payload.pull_request.number;
        const reviewId = context.payload.review.id;

        // Single GraphQL query for all PR data
        const {issue, timeline, reviews, prDetails, changedFiles} = await fetcher.fetchPullRequestData(
            owner,
            repo,
            pullNumber
        );

        // Find the specific review from the fetched reviews
        const review = reviews.reviews.find(r => r.id === reviewId);
        if (!review) {
            throw new Error(`Review ${reviewId} not found in PR ${pullNumber}`);
        }

        const promptText = formatter.formatPullRequestReviewPrompt(
            review,
            issue,
            timeline,
            reviews,
            prDetails,
            changedFiles
        );
        await setValidatedTextTask(junieTask, promptText, "pr-review");
    }

    // Handle PR review comment
    if (isPullRequestReviewCommentEvent(context)) {
        const pullNumber = context.payload.pull_request.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        // Single GraphQL query for all PR data
        const {issue, timeline, reviews, prDetails, changedFiles} = await fetcher.fetchPullRequestData(
            owner,
            repo,
            pullNumber
        );

        const promptText = formatter.formatPullRequestReviewCommentPrompt(
            issue,
            timeline,
            reviews,
            commentBody,
            commentAuthor,
            prDetails,
            changedFiles
        );
        await setValidatedTextTask(junieTask, promptText, "pr-review-comment");
    }

    // Handle PR event (opened/edited)
    if (isPullRequestEvent(context)) {
        const pullNumber = context.payload.pull_request.number;

        // Single GraphQL query for all PR data
        const {issue, timeline, reviews, prDetails, changedFiles} = await fetcher.fetchPullRequestData(
            owner,
            repo,
            pullNumber
        );

        const promptText = formatter.formatPullRequestPrompt(
            issue,
            timeline,
            reviews,
            prDetails,
            changedFiles
        );
        await setValidatedTextTask(junieTask, promptText, "pull-request");
    }

    if (context.inputs.resolveConflicts || isReviewOrCommentHasTrigger(context, RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP)) {
        junieTask.mergeTask = {branch: branchInfo.baseBranch, type: "merge"}
    }

    core.setOutput(OUTPUT_VARS.EJ_TASK, JSON.stringify(junieTask));

    return junieTask;
}
