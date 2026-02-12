import {ISSUE_QUERY, IssueQueryResponse, PULL_REQUEST_QUERY, PullRequestQueryResponse, GraphQLPullRequest, GraphQLIssue, GraphQLIssueCommentNode, GraphQLReviewNode, GraphQLReviewCommentNode} from "../api/queries";
import {Octokits} from "./client";
import { executeWithRetry } from "../../utils/retry";
import {
    filterCommentsToTriggerTime,
    filterReviewsToTriggerTime,
    isBodySafeToUse
} from "./time-filter";
import {downloadAttachmentsAndRewriteText} from "../junie/attachment-downloader";

/**
 * GraphQL-based data fetcher - fetches all data in a single request
 * This is much more efficient than making multiple REST API calls
 */
export class GraphQLGitHubDataFetcher {
    constructor(private octokit: Octokits) {}

    /**
     * Downloads attachments for a text/bodyHTML pair and returns the processed text
     */
    private async processAttachments(body: string, bodyHTML: string): Promise<string> {
        try {
            return await downloadAttachmentsAndRewriteText(body, bodyHTML);
        } catch (error) {
            console.error('Failed to process attachments:', error);
            // Return original body if processing fails
            return body;
        }
    }

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

        // Filter timeline comments to trigger time
        const filteredTimelineNodes = filterCommentsToTriggerTime(
            pr.timelineItems.nodes,
            triggerTime
        );

        // Filter reviews to trigger time
        const filteredReviews = filterReviewsToTriggerTime(
            pr.reviews.nodes,
            triggerTime
        );

        // Filter review comments within each review
        const reviewsWithFilteredComments = filteredReviews.map(review => ({
            ...review,
            comments: {
                nodes: filterCommentsToTriggerTime(
                    review.comments.nodes,
                    triggerTime
                )
            }
        }));

        // Check if body is safe to use
        const bodyIsSafe = isBodySafeToUse(pr, triggerTime);
        if (!bodyIsSafe) {
            console.warn(
                `Security: PR #${pullNumber} body was edited after the trigger event. ` +
                `Excluding body content to prevent potential injection attacks.`
            );
        }

        // Process attachments in PR body
        const processedPrBody = bodyIsSafe && pr.body ?
            await this.processAttachments(pr.body, pr.bodyHTML) : "";

        // Process attachments in timeline comments
        const processedTimelineNodes = await Promise.all(
            filteredTimelineNodes.map(async (node) => {
                if (node.__typename === "IssueComment" && node.body) {
                    const processedBody = await this.processAttachments(node.body, node.bodyHTML);
                    return {...node, body: processedBody};
                }
                return node;
            })
        );

        // Process attachments in reviews and review comments
        const processedReviews = await Promise.all(
            reviewsWithFilteredComments.map(async (review) => {
                const processedReviewBody = review.body ?
                    await this.processAttachments(review.body, review.bodyHTML) : "";

                const processedComments = await Promise.all(
                    review.comments.nodes.map(async (comment) => {
                        if (comment.body) {
                            const processedBody = await this.processAttachments(comment.body, comment.bodyHTML);
                            return {...comment, body: processedBody};
                        }
                        return comment;
                    })
                );

                return {
                    ...review,
                    body: processedReviewBody,
                    comments: {nodes: processedComments}
                };
            })
        );

        // Create filtered PR object with processed attachments
        const filteredPR: GraphQLPullRequest = {
            ...pr,
            body: processedPrBody,
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

        // Filter timeline comments to trigger time
        const filteredTimelineNodes = filterCommentsToTriggerTime(
            issue.timelineItems.nodes,
            triggerTime
        );

        // Check if body is safe to use
        const bodyIsSafe = isBodySafeToUse(issue, triggerTime);
        if (!bodyIsSafe) {
            console.warn(
                `Security: Issue #${issueNumber} body was edited after the trigger event. ` +
                `Excluding body content to prevent potential injection attacks.`
            );
        }

        // Process attachments in issue body
        const processedIssueBody = bodyIsSafe && issue.body ?
            await this.processAttachments(issue.body, issue.bodyHTML) : "";

        // Process attachments in timeline comments
        const processedTimelineNodes = await Promise.all(
            filteredTimelineNodes.map(async (node) => {
                if (node.__typename === "IssueComment" && node.body) {
                    const processedBody = await this.processAttachments(node.body, node.bodyHTML);
                    return {...node, body: processedBody};
                }
                return node;
            })
        );

        // Create filtered issue object with processed attachments
        const filteredIssue: GraphQLIssue = {
            ...issue,
            body: processedIssueBody,
            timelineItems: {
                nodes: processedTimelineNodes
            }
        };

        return {
            issue: filteredIssue
        };
    }
}
