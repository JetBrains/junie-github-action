import {execFileSync} from "child_process";
import {ISSUE_QUERY, IssueQueryResponse, PULL_REQUEST_QUERY, PullRequestQueryResponse} from "../api/queries";
import {Octokits} from "./client";
import {convertTimelineItems} from "../junie/timeline-converter";
import {
    GitHubFileChange,
    GitHubIssueData,
    GitHubPullRequestDetails, GitHubReviewCommentData,
    GitHubReviewData, GitHubReviewsData, GitHubReviewThread,
    GitHubTimelineData
} from "./github-data";

/**
 * GraphQL-based data fetcher - fetches all data in a single request
 * This is much more efficient than making multiple REST API calls
 */
export class GraphQLGitHubDataFetcher {
    constructor(private octokit: Octokits) {}

    /**
     * Fetch all PR data in a single GraphQL query
     */
    async fetchPullRequestData(owner: string, repo: string, pullNumber: number) {
        const response = await this.octokit.graphql<PullRequestQueryResponse>(PULL_REQUEST_QUERY, {
            owner,
            repo,
            number: pullNumber
        });

        const pr = response.repository.pullRequest;

        // Convert to our internal types
        const issue: GitHubIssueData = {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state.toLowerCase(),
            user: {login: pr.author?.login || "ghost"}
        };

        const prDetails: GitHubPullRequestDetails = {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state.toLowerCase(),
            html_url: pr.url,
            user: {login: pr.author?.login || "ghost"},
            head: {
                ref: pr.headRefName,
                sha: pr.headRefOid
            },
            base: {
                ref: pr.baseRefName,
                sha: pr.baseRefOid
            },
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changedFiles,
            commits: pr.commits.totalCount
        };

        // GraphQL doesn't provide SHA, so compute it using git hash-object
        const changedFiles: GitHubFileChange[] = pr.files.nodes.map((file) => {
            let sha: string;

            // Don't compute SHA for deleted files
            if (file.changeType === "DELETED") {
                sha = "deleted";
            } else {
                try {
                    // Use git hash-object to compute the SHA for the current file content
                    sha = execFileSync("git", ["hash-object", file.path], {
                        encoding: "utf-8"
                    }).trim();
                } catch (error) {
                    console.warn(`Failed to compute SHA for ${file.path}:`, error);
                    sha = "unknown";
                }
            }

            return {
                sha,
                filename: file.path,
                status: file.changeType.toLowerCase(),
                additions: file.additions,
                deletions: file.deletions,
                changes: file.additions + file.deletions
            };
        });

        // Convert timeline items using shared converter
        const timeline: GitHubTimelineData = convertTimelineItems(pr.timelineItems.nodes);

        // Convert reviews
        const reviews: GitHubReviewData[] = pr.reviews.nodes.map((review) => ({
            id: review.databaseId,
            user: {login: review.author?.login || "ghost"},
            body: review.body || "",
            state: review.state,
            html_url: review.url,
            submitted_at: review.submittedAt,
            pull_request_url: pr.url
        }));

        // Group review comments into threads
        const threads: GitHubReviewThread[] = [];
        const threadMap = new Map<string, GitHubReviewCommentData[]>();

        for (const review of pr.reviews.nodes) {
            for (const comment of review.comments.nodes) {
                const commentData: GitHubReviewCommentData = {
                    id: comment.databaseId,
                    body: comment.body,
                    user: {login: comment.author?.login || "ghost"},
                    created_at: comment.createdAt,
                    html_url: comment.url,
                    path: comment.path,
                    position: comment.position,
                    diff_hunk: comment.diffHunk,
                    pull_request_review_id: review.databaseId
                };

                // Group by path:position or replyTo
                const threadKey = comment.replyTo?.id || `${comment.path}:${comment.position}`;
                if (!threadMap.has(threadKey)) {
                    threadMap.set(threadKey, []);
                }
                threadMap.get(threadKey)!.push(commentData);
            }
        }

        // Create thread objects
        for (const threadComments of threadMap.values()) {
            const isResolved = threadComments.some((c) => c.position === null);
            const resolvedBy = isResolved && threadComments.length > 0
                ? threadComments[threadComments.length - 1].user
                : null;

            threads.push({
                comments: threadComments,
                isResolved,
                resolvedBy
            });
        }

        const reviewsData: GitHubReviewsData = {
            reviews,
            threads
        };

        return {
            issue,
            timeline,
            reviews: reviewsData,
            prDetails,
            changedFiles
        };
    }

    /**
     * Fetch all issue data in a single GraphQL query
     */
    async fetchIssueData(owner: string, repo: string, issueNumber: number) {
        const response = await this.octokit.graphql<IssueQueryResponse>(ISSUE_QUERY, {
            owner,
            repo,
            number: issueNumber
        });

        const issueData = response.repository.issue;

        const issue: GitHubIssueData = {
            number: issueData.number,
            title: issueData.title,
            body: issueData.body,
            state: issueData.state.toLowerCase(),
            user: {login: issueData.author?.login || "ghost"}
        };

        // Convert timeline items using shared converter
        const timeline: GitHubTimelineData = convertTimelineItems(issueData.timelineItems.nodes);

        return {
            issue,
            timeline
        };
    }
}
