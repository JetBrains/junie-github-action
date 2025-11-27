// GraphQL response types for type-safe data fetching

export interface GraphQLUser {
    login: string;
}

export interface GraphQLCommit {
    oid: string;
    message?: string;
    messageHeadline?: string;
    committedDate?: string;
}

export interface GraphQLIssueCommentNode {
    __typename: "IssueComment";
    id: string;
    databaseId: number;
    body: string;
    author: GraphQLUser | null;
    createdAt: string;
    url: string;
}

export interface GraphQLReferencedEventNode {
    __typename: "ReferencedEvent";
    commit: GraphQLCommit | null;
    createdAt: string;
}

export interface GraphQLCrossReferencedSource {
    __typename: "PullRequest" | "Issue";
    number: number;
    title: string;
    url: string;
}

export interface GraphQLCrossReferencedEventNode {
    __typename: "CrossReferencedEvent";
    source: GraphQLCrossReferencedSource | null;
    createdAt: string;
}

export type GraphQLTimelineItemNode =
    | GraphQLIssueCommentNode
    | GraphQLReferencedEventNode
    | GraphQLCrossReferencedEventNode;

export interface GraphQLTimelineItems {
    nodes: GraphQLTimelineItemNode[];
}

export interface GraphQLFileNode {
    path: string;
    additions: number;
    deletions: number;
    changeType: string;
}

export interface GraphQLFiles {
    nodes: GraphQLFileNode[];
}

export interface GraphQLCommitNode {
    commit: GraphQLCommit;
}

export interface GraphQLCommits {
    totalCount: number;
    nodes: GraphQLCommitNode[];
}

export interface GraphQLReviewCommentNode {
    id: string;
    databaseId: number;
    body: string;
    path: string;
    position: number | null;
    diffHunk: string;
    author: GraphQLUser | null;
    createdAt: string;
    url: string;
    replyTo: { id: string } | null;
}

export interface GraphQLReviewComments {
    nodes: GraphQLReviewCommentNode[];
}

export interface GraphQLReviewNode {
    id: string;
    databaseId: number;
    author: GraphQLUser | null;
    body: string;
    state: string;
    submittedAt: string;
    url: string;
    comments: GraphQLReviewComments;
}

export interface GraphQLReviews {
    nodes: GraphQLReviewNode[];
}

export interface GraphQLPullRequest {
    number: number;
    title: string;
    body: string;
    bodyHTML: string;
    state: string;
    url: string;
    author: GraphQLUser | null;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
    baseRefOid: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    createdAt: string;
    updatedAt: string;
    commits: GraphQLCommits;
    files: GraphQLFiles;
    timelineItems: GraphQLTimelineItems;
    reviews: GraphQLReviews;
}

export interface GraphQLIssue {
    number: number;
    title: string;
    body: string;
    bodyHTML: string;
    state: string;
    url: string;
    author: GraphQLUser | null;
    createdAt: string;
    updatedAt: string;
    timelineItems: GraphQLTimelineItems;
}

export interface PullRequestQueryResponse {
    repository: {
        pullRequest: GraphQLPullRequest;
    };
}

export interface IssueQueryResponse {
    repository: {
        issue: GraphQLIssue;
    };
}

// Type guards for timeline items
export function isIssueCommentNode(node: GraphQLTimelineItemNode): node is GraphQLIssueCommentNode {
    return node.__typename === "IssueComment";
}

export function isReferencedEventNode(node: GraphQLTimelineItemNode): node is GraphQLReferencedEventNode {
    return node.__typename === "ReferencedEvent";
}

export function isCrossReferencedEventNode(node: GraphQLTimelineItemNode): node is GraphQLCrossReferencedEventNode {
    return node.__typename === "CrossReferencedEvent";
}
