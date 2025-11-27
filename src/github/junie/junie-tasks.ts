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
import {GitHubDataFetcher} from "./github-data-fetcher";
import {GitHubPromptFormatter} from "./prompt-formatter";
import {validateInputSize} from "../validation/input-size";

function setValidatedTextTask(junieTask: JunieTask, text: string, taskType: string): void {
    validateInputSize(text, taskType);
    junieTask.textTask = {text};
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
    const fetcher = new GitHubDataFetcher(octokit);
    const formatter = new GitHubPromptFormatter();

    if (context.inputs.prompt) {
        setValidatedTextTask(junieTask, context.inputs.prompt, "user-prompt");
    }

    // Handle issue comment (not on PR)
    if (isIssueCommentEvent(context) && !context.isPR) {
        const issueNumber = context.payload.issue.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        const issue = await fetcher.fetchIssue(owner, repo, issueNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, issueNumber);

        const promptText = formatter.formatIssueCommentPrompt(
            issue,
            timeline,
            commentBody,
            commentAuthor
        );
        setValidatedTextTask(junieTask, promptText, "issue-comment");
    }

    // Handle issue event (opened/edited)
    if (isIssuesEvent(context)) {
        const issueNumber = context.payload.issue.number;

        const issue = await fetcher.fetchIssue(owner, repo, issueNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, issueNumber);

        const promptText = formatter.formatIssuePrompt(issue, timeline);
        setValidatedTextTask(junieTask, promptText, "issue");
    }

    // Handle PR comment
    if (isIssueCommentEvent(context) && context.isPR) {
        const pullNumber = context.payload.issue.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        const issue = await fetcher.fetchIssue(owner, repo, pullNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, pullNumber);
        const reviews = await fetcher.fetchReviews(owner, repo, pullNumber);

        const promptText = formatter.formatPullRequestCommentPrompt(
            issue,
            timeline,
            reviews,
            commentBody,
            commentAuthor
        );
        setValidatedTextTask(junieTask, promptText, "pr-comment");
    }

    // Handle PR review
    if (isPullRequestReviewEvent(context)) {
        const pullNumber = context.payload.pull_request.number;
        const reviewId = context.payload.review.id;

        const review = await fetcher.fetchReview(owner, repo, pullNumber, reviewId);
        const issue = await fetcher.fetchIssue(owner, repo, pullNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, pullNumber);
        const reviews = await fetcher.fetchReviews(owner, repo, pullNumber);

        const promptText = formatter.formatPullRequestReviewPrompt(
            review,
            issue,
            timeline,
            reviews
        );
        setValidatedTextTask(junieTask, promptText, "pr-review");
    }

    // Handle PR review comment
    if (isPullRequestReviewCommentEvent(context)) {
        const pullNumber = context.payload.pull_request.number;
        const commentBody = context.payload.comment.body;
        const commentAuthor = context.payload.comment.user.login;

        const issue = await fetcher.fetchIssue(owner, repo, pullNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, pullNumber);
        const reviews = await fetcher.fetchReviews(owner, repo, pullNumber);

        const promptText = formatter.formatPullRequestReviewCommentPrompt(
            issue,
            timeline,
            reviews,
            commentBody,
            commentAuthor
        );
        setValidatedTextTask(junieTask, promptText, "pr-review-comment");
    }

    // Handle PR event (opened/edited)
    if (isPullRequestEvent(context)) {
        const pullNumber = context.payload.pull_request.number;

        const issue = await fetcher.fetchIssue(owner, repo, pullNumber);
        const timeline = await fetcher.fetchTimeline(owner, repo, pullNumber);
        const reviews = await fetcher.fetchReviews(owner, repo, pullNumber);

        const promptText = formatter.formatPullRequestPrompt(issue, timeline, reviews);
        setValidatedTextTask(junieTask, promptText, "pull-request");
    }

    if (context.inputs.resolveConflicts || isReviewOrCommentHasTrigger(context, RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP)) {
        junieTask.mergeTask = {branch: branchInfo.baseBranch, type: "merge"}
    }

    core.setOutput(OUTPUT_VARS.EJ_TASK, JSON.stringify(junieTask));

    return junieTask;
}
