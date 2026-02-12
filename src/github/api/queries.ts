// GraphQL queries for GitHub data

export const PULL_REQUEST_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        title
        body
        bodyHTML
        state
        url
        author {
          login
        }
        baseRefName
        headRefName
        headRefOid
        baseRefOid
        additions
        deletions
        changedFiles
        createdAt
        updatedAt
        lastEditedAt

        # Commits
        commits(first: 100) {
          totalCount
          nodes {
            commit {
              oid
              messageHeadline
              message
              committedDate
            }
          }
        }

        # Changed files
        files(first: 100) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }

        # Timeline events (comments only)
        timelineItems(first: 100, itemTypes: [ISSUE_COMMENT]) {
          nodes {
            __typename
            ... on IssueComment {
              id
              databaseId
              body
              author {
                login
              }
              createdAt
              lastEditedAt
              url
            }
          }
        }

        # Reviews with their comments
        reviews(first: 100) {
          nodes {
            id
            databaseId
            author {
              login
            }
            body
            state
            submittedAt
            lastEditedAt
            url

            # Review comments (threads)
            comments(first: 100) {
              nodes {
                id
                databaseId
                body
                path
                position
                diffHunk
                author {
                  login
                }
                createdAt
                lastEditedAt
                url
                replyTo {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        number
        title
        body
        bodyHTML
        state
        url
        author {
          login
        }
        createdAt
        updatedAt
        lastEditedAt

        # Timeline events (comments only)
        timelineItems(first: 100, itemTypes: [ISSUE_COMMENT]) {
          nodes {
            __typename
            ... on IssueComment {
              id
              databaseId
              body
              author {
                login
              }
              createdAt
              lastEditedAt
              url
            }
          }
        }
      }
    }
  }
`;



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
    lastEditedAt: string | null;
    url: string;
}

export type GraphQLTimelineItemNode = GraphQLIssueCommentNode;

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
    lastEditedAt: string | null;
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
    lastEditedAt: string | null;
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
    lastEditedAt: string | null;
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
    lastEditedAt: string | null;
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

// Type guard for timeline items (now only comments)
export function isIssueCommentNode(node: GraphQLTimelineItemNode): node is GraphQLIssueCommentNode {
    return node.__typename === "IssueComment";
}

// Query to get current authenticated user/bot information
// Works for both PATs and GitHub App tokens
export const VIEWER_QUERY = `
  query {
    viewer {
      login
      databaseId
    }
  }
`;

export interface ViewerQueryResponse {
    viewer: {
        login: string;
        databaseId: number;
    };
}

export interface FetchedData {
    pullRequest?: GraphQLPullRequest;
    issue?: GraphQLIssue;
}
