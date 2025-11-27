import {
    GitHubCommentedEvent,
    GitHubCrossReferencedEvent,
    GitHubIssueData,
    GitHubReferencedEvent,
    GitHubReviewData,
    GitHubReviewsData,
    GitHubReviewThread,
    GitHubTimelineData,
    GitHubTimelineEventData,
    GitHubPullRequestDetails,
    GitHubFileChange
} from "./types/github-data";

export class GitHubPromptFormatter {

    private formatPRContext(pr: GitHubPullRequestDetails): string {
        return `PR #${pr.number}: ${pr.title}
Author: @${pr.user.login}
State: ${pr.state}
Branch: ${pr.head.ref} -> ${pr.base.ref}
Additions: +${pr.additions} / Deletions: -${pr.deletions}
Changed Files: ${pr.changed_files}
Commits: ${pr.commits}`;
    }

    private formatChangedFiles(files: GitHubFileChange[]): string {
        if (files.length === 0) {
            return 'No files changed';
        }

        return files.map(file =>
            `- ${file.filename} (${file.status}) +${file.additions}/-${file.deletions} SHA: ${file.sha}`
        ).join('\n');
    }

    private presentPullRequest(
        issue: GitHubIssueData,
        reviews: GitHubReviewsData,
        timeline: GitHubTimelineData,
        prDetails?: GitHubPullRequestDetails,
        changedFiles?: GitHubFileChange[]
    ): string {
        let result = '';

        if (prDetails) {
            result += `### PULL REQUEST CONTEXT:\n${this.formatPRContext(prDetails)}\n\n`;
        }

        result += `### PULL REQUEST: ${issue.title} [${issue.state}]\n${issue.body || ''}\n\n`;

        if (changedFiles) {
            result += `### CHANGED FILES:\n${this.formatChangedFiles(changedFiles)}\n\n`;
        }

        result += `### PULL REQUEST REVIEWS:\n${this.presentReviews(reviews)}\n\n`;
        result += `### PULL REQUEST TIMELINE:\n${this.presentTimeline(timeline)}`;

        return result;
    }

    private presentIssue(issue: GitHubIssueData, timeline: GitHubTimelineData): string {
        return `### ISSUE:
${issue.title} [${issue.state}]

${issue.body || ''}

### ISSUE TIMELINE:
${this.presentTimeline(timeline)}`;
    }

    private presentReviews(reviews: GitHubReviewsData): string {
        const reviewTexts: string[] = [];

        for (const review of reviews.reviews) {
            const reviewText = this.presentReview(review, reviews.threads);
            if (reviewText.trim()) {
                reviewTexts.push(reviewText);
            }
        }

        if (reviewTexts.length === 0) {
            return 'No unresolved review threads found.';
        }

        return reviewTexts.join('\n\n');
    }

    private presentReview(review: GitHubReviewData, threads: GitHubReviewThread[]): string {
        // Find threads for this review
        const reviewThreads = threads.filter(thread =>
            thread.comments.some(c => c.pull_request_review_id === review.id)
        );

        if (reviewThreads.length === 0) {
            return '';
        }

        const threadTexts: string[] = [];

        for (const thread of reviewThreads) {
            let firstComment = true;
            const comments = thread.comments.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );

            for (const comment of comments) {
                const author = comment.user.login;
                const body = comment.body;
                const createdAt = comment.created_at;
                const path = comment.path;
                const position = comment.position;
                const diffHunk = comment.diff_hunk;
                const isResolved = thread.isResolved;
                const resolvedBy = thread.resolvedBy?.login;

                let commentText = '';

                if (firstComment) {
                    firstComment = false;
                    commentText += `- ${createdAt} — ${path}:${position || ''} — Review from by @${author}`;
                    if (isResolved) {
                        commentText += ` (already RESOLVED by @${resolvedBy})`;
                    }
                    commentText += '\n';

                    if (diffHunk) {
                        const diffLines = diffHunk
                            .split('\n')
                            .map(line => `  ${line}`)
                            .join('\n');
                        commentText += `  \`\`\`\`\n${diffLines}\n  \`\`\`\`\n`;
                    }
                }

                const commentBody = body
                    .split('\n')
                    .map(line => `    ${line}`)
                    .join('\n');
                commentText += `  * ${createdAt} — Comment from @${author}:\n${commentBody}`;

                threadTexts.push(commentText);
            }
        }

        return threadTexts.join('\n');
    }

    private presentTimeline(timeline: GitHubTimelineData): string {
        const eventTexts: string[] = [];

        for (const event of timeline.events) {
            let eventText: string | null = null;

            if (this.isCommentedEvent(event)) {
                const author = event.user.login;
                const body = event.body;
                const createdAt = event.created_at;
                const bodyLines = body.split('\n').map(line => `  ${line}`).join('\n');
                eventText = `* ${createdAt} — Comment from @${author}:\n${bodyLines}`;
            } else if (this.isReferencedEvent(event)) {
                const commitId = event.commit_id;
                if (commitId) {
                    const hash = commitId.substring(0, 7);
                    const createdAt = event.created_at;
                    eventText = `* ${createdAt} — Commit: ${hash}`;
                }
            } else if (this.isCrossReferencedEvent(event)) {
                const source = event.source;
                const sourceIssue = source.issue;
                if (sourceIssue) {
                    const createdAt = event.created_at;
                    const isPullRequest = !!sourceIssue.pull_request;

                    if (isPullRequest && sourceIssue.pull_request) {
                        // Extract PR number from URL
                        const prNumber = sourceIssue.number;
                        eventText = `* ${createdAt} — Reference to PR #${prNumber}: ${sourceIssue.title}`;

                        // Optionally fetch PR details if needed
                        // This could be extended to include commits info like in Kotlin version
                    } else {
                        eventText = `* ${createdAt} — Reference to Issue #${sourceIssue.number}: ${sourceIssue.title}`;
                    }
                }
            }

            if (eventText) {
                eventTexts.push(eventText);
            }
        }

        return eventTexts.join('\n\n');
    }

    private isCommentedEvent(event: GitHubTimelineEventData): event is GitHubCommentedEvent {
        return event.event === 'commented';
    }

    private isReferencedEvent(event: GitHubTimelineEventData): event is GitHubReferencedEvent {
        return event.event === 'referenced';
    }

    private isCrossReferencedEvent(event: GitHubTimelineEventData): event is GitHubCrossReferencedEvent {
        return event.event === 'cross-referenced';
    }

    formatPullRequestCommentPrompt(
        issue: GitHubIssueData,
        timeline: GitHubTimelineData,
        reviews: GitHubReviewsData,
        commentBody: string,
        commentAuthor: string,
        prDetails?: GitHubPullRequestDetails,
        changedFiles?: GitHubFileChange[]
    ): string {
        return `User @${commentAuthor} mentioned you in the comment on pull request '#${issue.number} ${issue.title}'.
Given the following user comment (aka user issue description) \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${commentBody}
</issue_description>


See below the whole PR for information:
${this.presentPullRequest(issue, reviews, timeline, prDetails, changedFiles)}`;
    }

    formatPullRequestReviewCommentPrompt(
        issue: GitHubIssueData,
        timeline: GitHubTimelineData,
        reviews: GitHubReviewsData,
        commentBody: string,
        commentAuthor: string,
        prDetails?: GitHubPullRequestDetails,
        changedFiles?: GitHubFileChange[]
    ): string {
        return `User @${commentAuthor} mentioned you in the review comment on pull request '#${issue.number} ${issue.title}'.
Given the following user comment (aka user issue description) \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${commentBody}
</issue_description>


See below the whole PR for information:
${this.presentPullRequest(issue, reviews, timeline, prDetails, changedFiles)}`;
    }

    formatPullRequestReviewPrompt(
        review: GitHubReviewData,
        issue: GitHubIssueData,
        timeline: GitHubTimelineData,
        reviews: GitHubReviewsData,
        prDetails?: GitHubPullRequestDetails,
        changedFiles?: GitHubFileChange[]
    ): string {
        return `User @${review.user.login} mentioned you in the review on pull request '#${issue.number} ${issue.title}'.
Given the following user review (aka user issue description) \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${this.presentReview(review, reviews.threads)}
</issue_description>


See below the whole PR for information:
${this.presentPullRequest(issue, reviews, timeline, prDetails, changedFiles)}`;
    }

    formatIssueCommentPrompt(
        issue: GitHubIssueData,
        timeline: GitHubTimelineData,
        commentBody: string,
        commentAuthor: string
    ): string {
        return `User @${commentAuthor} mentioned you in the comment on GitHub issue '#${issue.number} ${issue.title}'.
Given the following user comment (aka user issue description) \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${commentBody}
</issue_description>


See below the whole GitHub issue for information:
${this.presentIssue(issue, timeline)}`;
    }

    formatIssuePrompt(issue: GitHubIssueData, timeline: GitHubTimelineData): string {
        return `Given the following issue description \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${this.presentIssue(issue, timeline)}
</issue_description>`;
    }

    formatPullRequestPrompt(
        issue: GitHubIssueData,
        timeline: GitHubTimelineData,
        reviews: GitHubReviewsData,
        prDetails?: GitHubPullRequestDetails,
        changedFiles?: GitHubFileChange[]
    ): string {
        return `Given the following pull request \`<issue_description>\`, could you help me in implementing the necessary changes to meet the specified requirements?
<issue_description>
${this.presentPullRequest(issue, reviews, timeline, prDetails, changedFiles)}
</issue_description>`;
    }
}
