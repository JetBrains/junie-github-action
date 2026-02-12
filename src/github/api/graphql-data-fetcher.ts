import {ISSUE_QUERY, IssueQueryResponse, PULL_REQUEST_QUERY, PullRequestQueryResponse, GraphQLPullRequest, GraphQLIssue} from "../api/queries";
import {Octokits} from "./client";
import { executeWithRetry } from "../../utils/retry";
import {
    filterCommentsToTriggerTime,
    filterReviewsToTriggerTime,
    isBodySafeToUse
} from "./time-filter";

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

        // Create filtered PR object
        const filteredPR: GraphQLPullRequest = {
            ...pr,
            body: bodyIsSafe ? pr.body : "",
            timelineItems: {
                nodes: filteredTimelineNodes
            },
            reviews: {
                nodes: reviewsWithFilteredComments
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

        // Create filtered issue object
        const filteredIssue: GraphQLIssue = {
            ...issue,
            body: bodyIsSafe ? issue.body : "",
            timelineItems: {
                nodes: filteredTimelineNodes
            }
        };

        return {
            issue: filteredIssue
        };
    }
}
