import {ISSUE_QUERY, IssueQueryResponse, PULL_REQUEST_QUERY, PullRequestQueryResponse, GraphQLPullRequest, GraphQLIssue, GraphQLIssueCommentNode} from "./queries";
import {Octokits} from "./client";
import { executeWithRetry } from "../../utils/retry";
import {
    filterCommentsToTriggerTime,
    filterReviewsToTriggerTime,
    isBodySafeToUse
} from "./time-filter";
import {downloadAttachmentsFromHtml, replaceAttachmentsInText} from "../junie/attachment-downloader";

/**
 * Process timeline comments: download attachments and replace URLs
 */
async function processTimelineComments(
    comments: GraphQLIssueCommentNode[]
): Promise<GraphQLIssueCommentNode[]> {
    return Promise.all(
        comments.map(async (comment) => {
            if (!comment.body || !comment.bodyHTML) return comment;

            try {
                const commentAttachments = await downloadAttachmentsFromHtml(comment.bodyHTML);
                return {
                    ...comment,
                    body: commentAttachments.size > 0
                        ? replaceAttachmentsInText(comment.body, commentAttachments)
                        : comment.body
                };
            } catch (error) {
                console.error(`Failed to process comment attachments:`, error);
            }

            return comment;
        })
    );
}

/**
 * GraphQL-based data fetcher - fetches all data in a single request
 * This is much more efficient than making multiple REST API calls
 */
export class GraphQLGitHubDataFetcher {
    constructor(private octokit: Octokits) {}

    /**
     * Execute a GraphQL query with retry logic for transient failures
     * Retries on network errors and rate limit errors, but not on schema/validation errors
     */
    private async executeGraphQLWithRetry<T>(
        query: string,
        variables: Record<string, any>
    ): Promise<T> {
        return executeWithRetry(
            () => this.octokit.graphql<T>(query, variables),
            'GraphQL query'
        );
    }

    /**
     * Fetch all PR data in a single GraphQL query and filter by trigger time
     */
    async fetchPullRequestData(owner: string, repo: string, pullNumber: number, triggerTime?: string) {
        const response = await this.executeGraphQLWithRetry<PullRequestQueryResponse>(
            PULL_REQUEST_QUERY,
            {
                owner,
                repo,
                number: pullNumber
            }
        );

        const pr = response.repository.pullRequest;

        // Check if body is safe to use
        const bodyIsSafe = isBodySafeToUse(pr, triggerTime);
        if (!bodyIsSafe) {
            console.warn(
                `Security: PR #${pullNumber} body was edited after the trigger event. ` +
                `Excluding body content to prevent potential injection attacks.`
            );
        }

        // Process PR body: download attachments and replace URLs
        let processedBody = "";
        if (bodyIsSafe && pr.body && pr.bodyHTML) {
            console.log(`Processing attachments for PR #${pullNumber}`);
            try {
                console.log(`Using GraphQL bodyHTML for PR #${pullNumber} (${pr.bodyHTML.length} chars)`);
                const bodyAttachments = await downloadAttachmentsFromHtml(pr.bodyHTML);
                processedBody = bodyAttachments.size > 0
                    ? replaceAttachmentsInText(pr.body, bodyAttachments)
                    : pr.body;
            } catch (error) {
                console.error(`Failed to process PR body attachments:`, error);
                processedBody = pr.body;
            }
        } else {
            if (!bodyIsSafe) {
                console.log(`PR #${pullNumber} body is not safe to use (edited after trigger)`);
            }
            if (!pr.body) {
                console.log(`PR #${pullNumber} has no body`);
            }
        }

        // Filter and process timeline comments
        const filteredTimelineNodes = filterCommentsToTriggerTime(
            pr.timelineItems.nodes,
            triggerTime
        );

        const processedTimelineNodes = await processTimelineComments(
            filteredTimelineNodes
        );

        // Filter reviews
        const filteredReviews = filterReviewsToTriggerTime(
            pr.reviews.nodes,
            triggerTime
        );

        // Process each review and its comments
        const processedReviews = await Promise.all(
            filteredReviews.map(async (review) => {
                // Filter review comments
                const filteredReviewComments = filterCommentsToTriggerTime(
                    review.comments.nodes,
                    triggerTime
                );

                // Process review body
                let processedReviewBody = review.body;
                if (review.body && review.bodyHTML) {
                    try {
                        const reviewAttachments = await downloadAttachmentsFromHtml(review.bodyHTML);
                        processedReviewBody = reviewAttachments.size > 0
                            ? replaceAttachmentsInText(review.body, reviewAttachments)
                            : review.body;
                    } catch (error) {
                        console.error(`Failed to process review body attachments:`, error);
                    }
                }

                // Process each review comment
                const processedReviewComments = await Promise.all(
                    filteredReviewComments.map(async (comment) => {
                        if (!comment.body || !comment.bodyHTML) return comment;

                        try {
                            const commentAttachments = await downloadAttachmentsFromHtml(comment.bodyHTML);
                            return {
                                ...comment,
                                body: commentAttachments.size > 0
                                    ? replaceAttachmentsInText(comment.body, commentAttachments)
                                    : comment.body
                            };
                        } catch (error) {
                            console.error(`Failed to process review comment attachments:`, error);
                        }

                        return comment;
                    })
                );

                return {
                    ...review,
                    body: processedReviewBody,
                    comments: {
                        nodes: processedReviewComments
                    }
                };
            })
        );

        // Create filtered PR object
        const filteredPR: GraphQLPullRequest = {
            ...pr,
            body: processedBody,
            timelineItems: {
                nodes: processedTimelineNodes
            },
            reviews: {
                nodes: processedReviews
            }
        };

        return {
            pullRequest: filteredPR
        };
    }

    /**
     * Fetch all issue data in a single GraphQL query and filter by trigger time
     */
    async fetchIssueData(owner: string, repo: string, issueNumber: number, triggerTime?: string) {
        const response = await this.executeGraphQLWithRetry<IssueQueryResponse>(
            ISSUE_QUERY,
            {
                owner,
                repo,
                number: issueNumber
            }
        );

        const issue = response.repository.issue;

        // Check if body is safe to use
        const bodyIsSafe = isBodySafeToUse(issue, triggerTime);
        if (!bodyIsSafe) {
            console.warn(
                `Security: Issue #${issueNumber} body was edited after the trigger event. ` +
                `Excluding body content to prevent potential injection attacks.`
            );
        }

        // Process issue body: download attachments and replace URLs
        let processedBody = "";
        if (bodyIsSafe && issue.body && issue.bodyHTML) {
            console.log(`Processing attachments for issue #${issueNumber}`);
            try {
                console.log(`Using GraphQL bodyHTML for issue #${issueNumber} (${issue.bodyHTML.length} chars)`);
                const bodyAttachments = await downloadAttachmentsFromHtml(issue.bodyHTML);
                processedBody = bodyAttachments.size > 0
                    ? replaceAttachmentsInText(issue.body, bodyAttachments)
                    : issue.body;
            } catch (error) {
                console.error(`Failed to process issue body attachments:`, error);
                processedBody = issue.body;
            }
        } else {
            if (!bodyIsSafe) {
                console.log(`Issue #${issueNumber} body is not safe to use (edited after trigger)`);
            }
            if (!issue.body) {
                console.log(`Issue #${issueNumber} has no body`);
            }
        }

        // Filter and process timeline comments
        const filteredTimelineNodes = filterCommentsToTriggerTime(
            issue.timelineItems.nodes,
            triggerTime
        );

        const processedTimelineNodes = await processTimelineComments(
            filteredTimelineNodes
        );

        // Create filtered issue object
        const filteredIssue: GraphQLIssue = {
            ...issue,
            body: processedBody,
            timelineItems: {
                nodes: processedTimelineNodes
            }
        };

        return {
            issue: filteredIssue
        };
    }
}
