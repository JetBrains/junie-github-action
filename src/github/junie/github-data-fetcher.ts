import {Octokits} from "../api/client";
import {
    GitHubIssueData,
    GitHubTimelineData,
    GitHubReviewsData,
    GitHubReviewData,
    GitHubReviewThread,
    GitHubTimelineEventData
} from "./types/github-data";

export class GitHubDataFetcher {
    constructor(private octokit: Octokits) {
    }

    async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssueData> {
        const {data} = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
        });
        return data as GitHubIssueData;
    }

    async fetchReview(owner: string, repo: string, pullNumber: number, reviewId: number): Promise<GitHubReviewData> {
        const {data} = await this.octokit.rest.pulls.getReview({
            owner,
            repo,
            pull_number: pullNumber,
            review_id: reviewId,
        });
        return data as GitHubReviewData;
    }

    async fetchTimeline(owner: string, repo: string, issueNumber: number): Promise<GitHubTimelineData> {
        const {data} = await this.octokit.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: issueNumber,
        });
        return {events: data as GitHubTimelineEventData[]};
    }

    async fetchReviews(owner: string, repo: string, pullNumber: number): Promise<GitHubReviewsData> {
        // Fetch reviews
        const {data: reviews} = await this.octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pullNumber,
        });

        // Fetch review comments
        const {data: comments} = await this.octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullNumber,
        });

        // Group comments by review thread
        const threads: GitHubReviewThread[] = [];
        const commentsByReview = new Map<number, any[]>();

        for (const comment of comments) {
            const reviewId = comment.pull_request_review_id;
            if (reviewId) {
                if (!commentsByReview.has(reviewId)) {
                    commentsByReview.set(reviewId, []);
                }
                commentsByReview.get(reviewId)!.push(comment);
            }
        }

        // Create threads from grouped comments
        for (const [reviewId, reviewComments] of commentsByReview) {
            // Group by thread (using in_reply_to_id or path+position)
            const threadMap = new Map<string, any[]>();

            for (const comment of reviewComments) {
                const threadKey = comment.in_reply_to_id?.toString() || `${comment.path}:${comment.position}`;
                if (!threadMap.has(threadKey)) {
                    threadMap.set(threadKey, []);
                }
                threadMap.get(threadKey)!.push(comment);
            }

            // Create thread objects
            for (const threadComments of threadMap.values()) {
                const isResolved = threadComments.every((c: any) => c.in_reply_to_id !== undefined);
                const resolvedBy = isResolved && threadComments.length > 0
                    ? threadComments[threadComments.length - 1].user
                    : null;

                threads.push({
                    comments: threadComments.map((c: any) => ({
                        id: c.id,
                        body: c.body,
                        user: c.user,
                        created_at: c.created_at,
                        html_url: c.html_url,
                        path: c.path,
                        position: c.position,
                        diff_hunk: c.diff_hunk,
                        pull_request_review_id: c.pull_request_review_id,
                    })),
                    isResolved,
                    resolvedBy,
                });
            }
        }

        return {
            reviews: reviews as GitHubReviewData[],
            threads,
        };
    }
}
