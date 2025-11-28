// GitHub API data types for prompt formatting

export interface GitHubUser {
    login: string;
}

export interface GitHubIssueData {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: GitHubUser;
    pull_request?: {
        url: string;
        html_url: string;
        diff_url: string;
    };
}

export interface GitHubPullRequestDetails {
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    user: GitHubUser;
    head: {
        ref: string;
        sha: string;
    };
    base: {
        ref: string;
        sha: string;
    };
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
}

export interface GitHubFileChange {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
}

export interface GitHubReviewCommentData {
    id: number;
    body: string;
    user: GitHubUser;
    created_at: string;
    html_url: string;
    path: string;
    position: number | null;
    diff_hunk: string | null;
    pull_request_review_id: number;
}

export interface GitHubReviewThread {
    comments: GitHubReviewCommentData[];
    isResolved: boolean;
    resolvedBy: GitHubUser | null;
}

export interface GitHubReviewData {
    id: number;
    user: GitHubUser;
    body: string;
    state: string;
    html_url: string;
    submitted_at: string;
    pull_request_url: string;
}

export interface GitHubReviewsData {
    reviews: GitHubReviewData[];
    threads: GitHubReviewThread[];
}

export interface GitHubTimelineEvent {
    event: string;
    created_at: string;
}

export interface GitHubCommentedEvent extends GitHubTimelineEvent {
    event: 'commented';
    body: string;
    user: GitHubUser;
    html_url: string;
}

export interface GitHubReferencedEvent extends GitHubTimelineEvent {
    event: 'referenced';
    commit_id: string | null;
}

export interface GitHubCrossReferencedEvent extends GitHubTimelineEvent {
    event: 'cross-referenced';
    source: {
        type: string;
        issue?: {
            number: number;
            title: string;
            html_url: string;
            pull_request?: {
                url: string;
                html_url: string;
            };
        };
    };
}

export type GitHubTimelineEventData =
    | GitHubCommentedEvent
    | GitHubReferencedEvent
    | GitHubCrossReferencedEvent
    | GitHubTimelineEvent;

export interface GitHubTimelineData {
    events: GitHubTimelineEventData[];
}
