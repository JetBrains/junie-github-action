import {describe, test, expect, mock, beforeEach} from "bun:test";
import {GraphQLGitHubDataFetcher} from "../src/github/api/graphql-data-fetcher";
import {Octokits} from "../src/github/api/client";
import type {PullRequestQueryResponse, IssueQueryResponse} from "../src/github/api/queries";

describe("GraphQLGitHubDataFetcher", () => {
    let mockOctokit: Octokits;
    let fetcher: GraphQLGitHubDataFetcher;

    beforeEach(() => {
        mockOctokit = {
            graphql: mock(() => Promise.resolve({})) as any,
            rest: {
                pulls: {
                    get: mock(() => Promise.resolve({
                        data: {
                            body_html: '<p>PR description</p>'
                        }
                    })) as any,
                    getReview: mock(() => Promise.resolve({
                        data: {
                            body_html: '<p>Review body</p>'
                        }
                    })) as any,
                    getReviewComment: mock(() => Promise.resolve({
                        data: {
                            body_html: '<p>Review comment</p>'
                        }
                    })) as any
                },
                issues: {
                    get: mock(() => Promise.resolve({
                        data: {
                            body_html: '<p>Issue description</p>'
                        }
                    })) as any,
                    getComment: mock(() => Promise.resolve({
                        data: {
                            body_html: '<p>Comment body</p>'
                        }
                    })) as any
                }
            } as any
        };
        fetcher = new GraphQLGitHubDataFetcher(mockOctokit);
    });

    describe("fetchPullRequestData", () => {
        test("should fetch and return PR data successfully", async () => {
            const mockPRResponse: PullRequestQueryResponse = {
                repository: {
                    pullRequest: {
                        number: 42,
                        title: "Test PR",
                        body: "PR description",
                        bodyHTML: "<p>PR description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/pull/42",
                        author: {login: "testuser"},
                        baseRefName: "main",
                        headRefName: "feature",
                        headRefOid: "abc123",
                        baseRefOid: "def456",
                        additions: 10,
                        deletions: 5,
                        changedFiles: 2,
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        commits: {
                            totalCount: 3,
                            nodes: [
                                {
                                    commit: {
                                        oid: "commit1",
                                        messageHeadline: "First commit",
                                        message: "First commit message",
                                        committedDate: "2024-01-01T00:00:00Z"
                                    }
                                }
                            ]
                        },
                        files: {
                            nodes: [
                                {
                                    path: "src/test.ts",
                                    additions: 10,
                                    deletions: 5,
                                    changeType: "MODIFIED"
                                },
                                {
                                    path: "src/deleted.ts",
                                    additions: 0,
                                    deletions: 20,
                                    changeType: "DELETED"
                                }
                            ]
                        },
                        timelineItems: {
                            nodes: [
                                {
                                    __typename: "IssueComment",
                                    id: "comment1",
                                    databaseId: 1,
                                    body: "Test comment",
                                    author: {login: "commenter"},
                                    createdAt: "2024-01-01T00:00:00Z",
                                    lastEditedAt: null,
                                    url: "https://github.com/owner/repo/issues/42#issuecomment-1"
                                }
                            ]
                        },
                        reviews: {
                            nodes: [
                                {
                                    id: "review1",
                                    databaseId: 1,
                                    author: {login: "reviewer"},
                                    body: "LGTM",
                                    state: "APPROVED",
                                    submittedAt: "2024-01-02T00:00:00Z",
                                    lastEditedAt: null,
                                    url: "https://github.com/owner/repo/pull/42#pullrequestreview-1",
                                    comments: {
                                        nodes: [
                                            {
                                                id: "comment1",
                                                databaseId: 1,
                                                body: "Nice work",
                                                path: "src/test.ts",
                                                position: 5,
                                                diffHunk: "@@ -1,3 +1,3 @@",
                                                author: {login: "reviewer"},
                                                createdAt: "2024-01-02T00:00:00Z",
                                                lastEditedAt: null,
                                                url: "https://github.com/owner/repo/pull/42#discussion_r1",
                                                replyTo: null
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                }
            };

            mockOctokit.graphql = mock(() => Promise.resolve(mockPRResponse)) as any;

            const result = await fetcher.fetchPullRequestData("owner", "repo", 42);

            expect(result.pullRequest.number).toBe(42);
            expect(result.pullRequest.title).toBe("Test PR");
            expect(result.pullRequest.state).toBe("OPEN");
            expect(result.pullRequest.author?.login).toBe("testuser");
            expect(result.pullRequest.additions).toBe(10);
            expect(result.pullRequest.deletions).toBe(5);
            expect(result.pullRequest.headRefName).toBe("feature");
            expect(result.pullRequest.baseRefName).toBe("main");
            expect(result.pullRequest.files.nodes).toHaveLength(2);
            expect(result.pullRequest.files.nodes[0].path).toBe("src/test.ts");
            expect(result.pullRequest.files.nodes[0].changeType).toBe("MODIFIED");
            expect(result.pullRequest.reviews.nodes).toHaveLength(1);
            expect(result.pullRequest.reviews.nodes[0].state).toBe("APPROVED");
            expect(result.pullRequest.reviews.nodes[0].comments.nodes).toHaveLength(1);
        });

        test("should handle null author", async () => {
            const mockPRResponse: PullRequestQueryResponse = {
                repository: {
                    pullRequest: {
                        number: 42,
                        title: "Test PR",
                        body: "PR description",
                        bodyHTML: "<p>PR description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/pull/42",
                        author: null,
                        baseRefName: "main",
                        headRefName: "feature",
                        headRefOid: "abc123",
                        baseRefOid: "def456",
                        additions: 0,
                        deletions: 0,
                        changedFiles: 0,
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        commits: {totalCount: 0, nodes: []},
                        files: {nodes: []},
                        timelineItems: {nodes: []},
                        reviews: {nodes: []}
                    }
                }
            };

            mockOctokit.graphql = mock(() => Promise.resolve(mockPRResponse)) as any;

            const result = await fetcher.fetchPullRequestData("owner", "repo", 42);

            expect(result.pullRequest.author).toBeNull();
        });

        test("should retry on transient errors", async () => {
            let callCount = 0;
            const mockPRResponse: PullRequestQueryResponse = {
                repository: {
                    pullRequest: {
                        number: 42,
                        title: "Test PR",
                        body: "PR description",
                        bodyHTML: "<p>PR description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/pull/42",
                        author: {login: "testuser"},
                        baseRefName: "main",
                        headRefName: "feature",
                        headRefOid: "abc123",
                        baseRefOid: "def456",
                        additions: 0,
                        deletions: 0,
                        changedFiles: 0,
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        commits: {totalCount: 0, nodes: []},
                        files: {nodes: []},
                        timelineItems: {nodes: []},
                        reviews: {nodes: []}
                    }
                }
            };

            mockOctokit.graphql = mock(() => {
                callCount++;
                if (callCount < 2) {
                    return Promise.reject({status: 500, message: "Internal Server Error"});
                }
                return Promise.resolve(mockPRResponse);
            }) as any;

            const result = await fetcher.fetchPullRequestData("owner", "repo", 42);

            expect(result.pullRequest.number).toBe(42);
            expect(callCount).toBe(2);
        });

        test("should not retry on 404 errors", async () => {
            mockOctokit.graphql = mock(() =>
                Promise.reject({status: 404, message: "Not Found"})
            ) as any;

            await expect(fetcher.fetchPullRequestData("owner", "repo", 42)).rejects.toThrow();
        });
    });

    describe("fetchIssueData", () => {
        test("should fetch and return issue data successfully", async () => {
            const mockIssueResponse: IssueQueryResponse = {
                repository: {
                    issue: {
                        number: 123,
                        title: "Test Issue",
                        body: "Issue description",
                        bodyHTML: "<p>Issue description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/issues/123",
                        author: {login: "issueauthor"},
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        timelineItems: {
                            nodes: [
                                {
                                    __typename: "IssueComment",
                                    id: "comment1",
                                    databaseId: 1,
                                    body: "Test comment",
                                    author: {login: "commenter"},
                                    createdAt: "2024-01-01T00:00:00Z",
                                    lastEditedAt: null,
                                    url: "https://github.com/owner/repo/issues/123#issuecomment-1"
                                }
                            ]
                        }
                    }
                }
            };

            mockOctokit.graphql = mock(() => Promise.resolve(mockIssueResponse)) as any;

            const result = await fetcher.fetchIssueData("owner", "repo", 123);

            expect(result.issue.number).toBe(123);
            expect(result.issue.title).toBe("Test Issue");
            expect(result.issue.state).toBe("OPEN");
            expect(result.issue.author?.login).toBe("issueauthor");
            expect(result.issue.timelineItems.nodes).toHaveLength(1);
        });

        test("should handle null author", async () => {
            const mockIssueResponse: IssueQueryResponse = {
                repository: {
                    issue: {
                        number: 123,
                        title: "Test Issue",
                        body: "Issue description",
                        bodyHTML: "<p>Issue description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/issues/123",
                        author: null,
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        timelineItems: {nodes: []}
                    }
                }
            };

            mockOctokit.graphql = mock(() => Promise.resolve(mockIssueResponse)) as any;

            const result = await fetcher.fetchIssueData("owner", "repo", 123);

            expect(result.issue.author).toBeNull();
        });

        test("should retry on transient errors", async () => {
            let callCount = 0;
            const mockIssueResponse: IssueQueryResponse = {
                repository: {
                    issue: {
                        number: 123,
                        title: "Test Issue",
                        body: "Issue description",
                        bodyHTML: "<p>Issue description</p>",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/issues/123",
                        author: {login: "issueauthor"},
                        createdAt: "2024-01-01T00:00:00Z",
                        updatedAt: "2024-01-02T00:00:00Z",
                        lastEditedAt: null,
                        timelineItems: {nodes: []}
                    }
                }
            };

            mockOctokit.graphql = mock(() => {
                callCount++;
                if (callCount < 3) {
                    return Promise.reject({status: 502, message: "Bad Gateway"});
                }
                return Promise.resolve(mockIssueResponse);
            }) as any;

            const result = await fetcher.fetchIssueData("owner", "repo", 123);

            expect(result.issue.number).toBe(123);
            expect(callCount).toBe(3);
        });

        test("should not retry on authentication errors", async () => {
            mockOctokit.graphql = mock(() =>
                Promise.reject({status: 401, message: "Unauthorized"})
            ) as any;

            await expect(fetcher.fetchIssueData("owner", "repo", 123)).rejects.toThrow();
        });
    });
});
