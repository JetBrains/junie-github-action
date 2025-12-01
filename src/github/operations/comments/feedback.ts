#!/usr/bin/env bun

import * as core from "@actions/core";
import {addJunieMarker, createCommentBody, createJobRunLink, hasJunieMarker} from "./common";
import {GitHubContext, isPullRequestReviewCommentEvent,} from "../../context";
import type {Octokit} from "@octokit/rest";
import {GITHUB_SERVER_URL} from "../../api/config";
import {OUTPUT_VARS} from "../../../constants/environment";
import {
    COMMIT_PUSHED_FEEDBACK_COMMENT_TEMPLATE,
    ERROR_FEEDBACK_COMMENT_TEMPLATE, MANUALLY_PR_CREATE_FEEDBACK_COMMENT_TEMPLATE, PR_CREATED_FEEDBACK_COMMENT_TEMPLATE,
    SUCCESS_FEEDBACK_COMMENT_WITH_RESULT
} from "../../../constants/github";
import type {FailureFeedbackData, FinishFeedbackData, SuccessFeedbackData} from "./types";

/**
 * Finds an existing Junie comment by searching for the hidden marker.
 *
 * For review comments (code-level), searches within the specific comment thread.
 * For issue/PR comments, searches globally within the issue/PR.
 *
 * @param octokit - Octokit REST client for GitHub API
 * @param context - GitHub context (contains event payload and entity number)
 * @returns The comment ID if found, or undefined if no Junie comment exists
 */
async function findExistingJunieComment(
    octokit: Octokit,
    context: GitHubContext,
): Promise<number | undefined> {
    // entityNumber is required for all comment searches
    // It's checked in writeInitialFeedbackComment, but we verify here too for safety
    if (!context.entityNumber) {
        return undefined;
    }

    const {owner, name} = context.payload.repository;
    const ownerLogin = owner.login;

    try {
        let comments;

        // Different APIs based on context type
        if (isPullRequestReviewCommentEvent(context)) {
            // For review comments (code-level comments), search within the specific thread
            const parentCommentId = context.payload.comment.id;
            console.log(`Searching for Junie comment in review thread ${parentCommentId}`);

            const response = await octokit.rest.pulls.listReviewComments({
                owner: ownerLogin,
                repo: name,
                pull_number: context.entityNumber,
                per_page: 100, // Get up to 100 most recent comments
            });

            // Filter comments to only those in the same thread
            // A comment is in the same thread if it's a direct reply (in_reply_to_id matches)
            // or if it's the parent comment itself
            comments = response.data.filter(comment =>
                comment.id === parentCommentId ||
                comment.in_reply_to_id === parentCommentId
            );

            console.log(`Found ${comments.length} comments in the review thread`);
        } else {
            // For issue comments and PR comments (conversation-level)
            const response = await octokit.rest.issues.listComments({
                owner: ownerLogin,
                repo: name,
                issue_number: context.entityNumber,
                per_page: 100, // Get up to 100 most recent comments
            });
            comments = response.data;
        }

        // Find the most recent comment with Junie marker for this workflow
        // Search in reverse order to find the most recent comment first
        const existingComment = comments
            .reverse()
            .find(comment => comment.body && hasJunieMarker(comment.body, context.workflow));

        if (existingComment) {
            console.log(`Found existing Junie comment with ID: ${existingComment.id}`);
            return existingComment.id;
        }

        console.log('No existing Junie comment found');
        return undefined;
    } catch (error) {
        console.error('Error searching for existing Junie comment:', error);
        // If we can't search for existing comments, return undefined
        // This allows the code to fall back to creating a new comment
        return undefined;
    }
}

/**
 * Updates an existing comment with new content.
 *
 * @param octokit - Octokit REST client for GitHub API
 * @param context - GitHub context (contains event payload and entity number)
 * @param commentId - ID of the comment to update
 * @param body - New content for the comment
 * @param ownerLogin - Repository owner login
 * @param repoName - Repository name
 */
async function updateExistingComment(
    octokit: Octokit,
    context: GitHubContext,
    commentId: number,
    body: string,
    ownerLogin: string,
    repoName: string,
): Promise<void> {
    console.log(`Updating existing comment ${commentId} with new content`);

    if (isPullRequestReviewCommentEvent(context)) {
        await octokit.rest.pulls.updateReviewComment({
            owner: ownerLogin,
            repo: repoName,
            comment_id: commentId,
            body: body,
        });
    } else {
        await octokit.rest.issues.updateComment({
            owner: ownerLogin,
            repo: repoName,
            comment_id: commentId,
            body: body,
        });
    }

    console.log(`Updated comment with ID: ${commentId}`);
}

/**
 * Creates an initial "Junie is working..." feedback comment on the issue/PR.
 *
 * This provides immediate feedback to users that Junie has started processing.
 * The comment includes a link to the GitHub Actions run for monitoring progress.
 * Later, this comment is updated with the final result.
 *
 * If useSingleComment is enabled, this will search for and update an existing Junie comment
 * instead of creating a new one.
 *
 * @param octokit - Octokit REST client for GitHub API
 * @param context - GitHub context (contains event payload and entity number)
 * @returns The comment ID (used later for updating), or undefined if skipped
 * @throws {Error} if unable to create comment (permissions, API limits, locked issue/PR)
 */
export async function writeInitialFeedbackComment(
    octokit: Octokit,
    context: GitHubContext,
) {
    if (context.inputs.silentMode) {
        console.log('Silent mode enabled - skipping initial feedback comment');
        return;
    }

    // Check if we have an entity to comment on (issue or PR number)
    // entityNumber is required for all comment types, including review comments
    if (!context.entityNumber) {
        console.log(`Skip creating initial comment for ${context.eventName} event - no entity number`);
        return;
    }

    const {owner, name} = context.payload.repository;
    const ownerLogin = owner.login;

    const jobRunLink = createJobRunLink(ownerLogin, name, context.runId);
    const initialBody = createCommentBody(jobRunLink, context.workflow);

    try {
        let initCommentId: number | undefined;

        // Check if we should use single comment mode
        if (context.inputs.useSingleComment) {
            console.log('Single comment mode enabled - searching for existing Junie comment');
            const existingCommentId = await findExistingJunieComment(octokit, context);

            if (existingCommentId) {
                // Update existing comment
                await updateExistingComment(octokit, context, existingCommentId, initialBody, ownerLogin, name);
                initCommentId = existingCommentId;
            } else {
                // No existing comment found, create a new one
                console.log('No existing Junie comment found - creating new comment');
                initCommentId = await createNewComment(octokit, context, initialBody, ownerLogin, name);
            }
        } else {
            // Single comment mode disabled, always create new comment
            initCommentId = await createNewComment(octokit, context, initialBody, ownerLogin, name);
        }

        // Only set output if we have a comment ID
        if (initCommentId !== undefined) {
            // Save comment ID as output for later retrieval in finish-feedback step
            core.setOutput(OUTPUT_VARS.INIT_COMMENT_ID, initCommentId);
        }

        return initCommentId;
    } catch (error) {
        const entityType = context.isPR ? 'PR' : context.entityNumber ? `issue #${context.entityNumber}` : 'event';
        const repoFullName = `${ownerLogin}/${name}`;
        console.error(`❌ Failed to create/update initial feedback comment for ${entityType}:`, error);
        throw new Error(
            `❌ Failed to create/update initial feedback comment on ${repoFullName}. ` +
            `This could be due to:\n` +
            `• Insufficient token permissions (needs 'issues:write' or 'pull_requests:write' scope)\n` +
            `• GitHub API rate limits\n` +
            `• The issue or PR may be locked or deleted\n` +
            `• Network connectivity issues\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Creates a new comment on the issue/PR.
 * Helper function to avoid code duplication.
 * Returns undefined if there's no entity to comment on.
 */
async function createNewComment(
    octokit: Octokit,
    context: GitHubContext,
    body: string,
    ownerLogin: string,
    repoName: string,
): Promise<number | undefined> {
    let response;

    // Different comment APIs based on context type
    if (isPullRequestReviewCommentEvent(context)) {
        // For review comments (code-level comments), create a reply to the review comment
        response = await octokit.rest.pulls.createReplyForReviewComment({
            owner: ownerLogin,
            repo: repoName,
            pull_number: context.entityNumber!,
            comment_id: context.payload.comment.id,
            body: body,
        });
    } else if (context.entityNumber) {
        // For issue comments and PR comments (conversation-level), use issues API
        // Note: GitHub treats PR comments as issue comments in the API
        response = await octokit.rest.issues.createComment({
            owner: ownerLogin,
            repo: repoName,
            issue_number: context.entityNumber,
            body: body,
        });
    } else {
        // No entity number means this is an automated event (workflow_dispatch, schedule, etc.)
        // These don't have a specific issue/PR to comment on
        console.log(`Skip creating initial comment for ${context.eventName} event`);
        return undefined;
    }

    console.log(`Created initial comment with ID: ${response.data.id}`);
    return response.data.id;
}


/**
 * Updates the initial feedback comment with the final Junie result.
 *
 * This is called after Junie completes (success or failure) to provide final feedback.
 * Updates the previously created comment with:
 * - Success: Commit SHA, PR link, or task completion message
 * - Failure: Error details and link to job logs
 *
 * @param octokit - Octokit REST client for GitHub API
 * @param data - Feedback data containing result, comment ID, and context
 * @throws {Error} if unable to update comment (permissions, comment deleted, API limits)
 */
export async function writeFinishFeedbackComment(
    octokit: Octokit,
    data: FinishFeedbackData
) {
    const {owner, name} = data.parsedContext.payload.repository;
    const ownerLogin = owner.login;
    const repoFullName = `${ownerLogin}/${name}`;
    const workflowName = data.parsedContext.workflow;

    let feedbackBody: string | undefined;
    if (data.isJobFailed) {
        feedbackBody = getFailedBody(ownerLogin, name, data.parsedContext.runId, data.failureData!, workflowName)
    } else {
        feedbackBody = getSuccessBody(repoFullName, data.successData!, workflowName)
    }

    if (!feedbackBody) {
        console.log('No feedback body - skipping feedback');
        return;
    }

    const initCommentId = +data.initCommentId;

    console.log(`Updating feedback comment ${initCommentId}`);

    try {
        await updateExistingComment(
            octokit,
            data.parsedContext,
            initCommentId,
            feedbackBody,
            ownerLogin,
            name
        );
        console.log('✓ Feedback comment updated successfully');
    } catch (error) {
        console.error(`❌ Failed to update feedback comment ${initCommentId}:`, error);
        throw new Error(
            `❌ Failed to update feedback comment on ${repoFullName}. ` +
            `This could be due to:\n` +
            `• Insufficient token permissions (needs 'issues:write' or 'pull_requests:write' scope)\n` +
            `• GitHub API rate limits\n` +
            `• The comment may have been deleted\n` +
            `• Network connectivity issues\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function getFailedBody(owner: string, repoName: string, runId: string, failureData: FailureFeedbackData, workflowName: string): string | undefined {
    const details = failureData.error || "Check job logs for more details"
    const jobLink = createJobRunLink(owner, repoName, runId)
    return addJunieMarker(ERROR_FEEDBACK_COMMENT_TEMPLATE(details, jobLink), workflowName);
}

function getSuccessBody(repoFullName: string, successData: SuccessFeedbackData, workflowName: string): string | undefined {
    let result: string | undefined;
    switch (successData.actionToDo) {
        case "COMMIT_CHANGES":
            console.log(`Commit pushed to current branch: ${successData.commitSHA}`);
            result = COMMIT_PUSHED_FEEDBACK_COMMENT_TEMPLATE(successData.commitSHA!, successData.junieTitle!, successData.junieSummary!);
            break;
        case "PUSH":
            console.log('Unpushed commits were pushed to remote');
            result = SUCCESS_FEEDBACK_COMMENT_WITH_RESULT(successData.junieTitle || 'Changes pushed', successData.junieSummary || 'Unpushed commits have been pushed to the remote branch');
            break;
        case "CREATE_PR":
            if (successData.prLink) {
                console.log(`PR was created: ${successData.prLink}`);
                result = PR_CREATED_FEEDBACK_COMMENT_TEMPLATE(successData.prLink);
            } else {
                console.log(`Create PR manually`);
                const createPRLink = `${GITHUB_SERVER_URL}/${repoFullName}/compare/${successData.baseBranch}...${successData.workingBranch}`;
                result = MANUALLY_PR_CREATE_FEEDBACK_COMMENT_TEMPLATE(createPRLink);
            }
            break;
        case "WRITE_COMMENT":
            console.log('No PR or commit - using Junie result');
            result = SUCCESS_FEEDBACK_COMMENT_WITH_RESULT(successData.junieTitle || 'Task completed', successData.junieSummary || 'No additional details');
            break;
    }

    return result ? addJunieMarker(result, workflowName) : undefined;
}