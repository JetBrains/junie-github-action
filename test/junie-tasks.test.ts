import {describe, test, expect, mock, beforeEach} from "bun:test";
import {prepareJunieTask} from "../src/github/junie/junie-tasks";
import {GitHubContext} from "../src/github/context";
import {BranchInfo} from "../src/github/operations/branch";
import {Octokits} from "../src/github/api/client";
import * as core from "@actions/core";

// Mock modules
mock.module("@actions/core", () => ({
    setOutput: mock(() => {}),
}));

mock.module("../src/github/junie/attachment-downloader", () => ({
    downloadAttachmentsAndRewriteText: mock((text: string) => Promise.resolve(text)),
}));

describe("prepareJunieTask", () => {
    const createMockContext = (overrides: Partial<GitHubContext> = {}): GitHubContext => {
        return {
            eventName: "issue_comment",
            runId: "123",
            actor: "testuser",
            actorEmail: "test@example.com",
            tokenOwner: "user",
            isPR: false,
            inputs: {
                resolveConflicts: false,
                createNewBranchForPR: false,
                junieWorkingDir: "/tmp",
                appToken: "token",
                prompt: "",
                triggerPhrase: "@junie",
                assigneeTrigger: "",
                labelTrigger: "",
                allowedMcpServers: ""
            },
            payload: {
                action: "created",
                issue: {
                    number: 123,
                    title: "Test Issue",
                    body: "Issue body",
                    state: "open",
                    user: {login: "author"}
                },
                comment: {
                    id: 1,
                    body: "@junie help",
                    user: {login: "commenter"}
                },
                repository: {
                    owner: {login: "owner"},
                    name: "repo"
                }
            } as any,
            ...overrides
        } as GitHubContext;
    };

    const createMockOctokit = (): Octokits => {
        return {
            // GraphQL method for new fetcher
            graphql: mock((query: string, variables: any) => {
                // Mock PR query response
                if (query.includes('pullRequest(number:')) {
                    return Promise.resolve({
                        repository: {
                            pullRequest: {
                                number: variables.number,
                                title: "Test PR",
                                body: "PR body",
                                bodyHTML: "<p>PR body</p>",
                                state: "OPEN",
                                url: `https://github.com/${variables.owner}/${variables.repo}/pull/${variables.number}`,
                                author: {login: "author"},
                                baseRefName: "main",
                                headRefName: "feature",
                                headRefOid: "abc123",
                                baseRefOid: "def456",
                                additions: 10,
                                deletions: 5,
                                changedFiles: 2,
                                createdAt: "2024-01-01T00:00:00Z",
                                updatedAt: "2024-01-01T00:00:00Z",
                                commits: {totalCount: 3, nodes: []},
                                files: {nodes: []},
                                timelineItems: {nodes: []},
                                reviews: {
                                    nodes: [
                                        {
                                            id: "review1",
                                            databaseId: 456,
                                            author: {login: "reviewer"},
                                            body: "Changes needed",
                                            state: "COMMENTED",
                                            submittedAt: "2024-01-01T00:00:00Z",
                                            url: `https://github.com/${variables.owner}/${variables.repo}/pull/${variables.number}#pullrequestreview-456`,
                                            comments: {nodes: []}
                                        }
                                    ]
                                }
                            }
                        }
                    });
                }
                // Mock Issue query response
                if (query.includes('issue(number:')) {
                    return Promise.resolve({
                        repository: {
                            issue: {
                                number: variables.number,
                                title: "Test Issue",
                                body: "Issue body",
                                bodyHTML: "<p>Issue body</p>",
                                state: "OPEN",
                                url: `https://github.com/${variables.owner}/${variables.repo}/issues/${variables.number}`,
                                author: {login: "author"},
                                createdAt: "2024-01-01T00:00:00Z",
                                updatedAt: "2024-01-01T00:00:00Z",
                                timelineItems: {nodes: []}
                            }
                        }
                    });
                }
                return Promise.resolve({});
            }),
            rest: {
                issues: {
                    get: mock(() => Promise.resolve({
                        data: {
                            number: 123,
                            title: "Test Issue",
                            body: "Issue body",
                            state: "open",
                            user: {login: "author"}
                        }
                    })),
                    listEventsForTimeline: mock(() => Promise.resolve({
                        data: []
                    }))
                },
                pulls: {
                    get: mock(() => Promise.resolve({
                        data: {
                            number: 123,
                            title: "Test PR",
                            state: "open",
                            user: {login: "author"},
                            head: {ref: "feature", sha: "abc123"},
                            base: {ref: "main", sha: "def456"},
                            additions: 10,
                            deletions: 5,
                            changed_files: 2,
                            commits: 3
                        }
                    })),
                    getReview: mock(() => Promise.resolve({
                        data: {
                            id: 1,
                            user: {login: "reviewer"},
                            body: "Review body",
                            state: "COMMENTED"
                        }
                    })),
                    listFiles: mock(() => Promise.resolve({
                        data: [
                            {
                                sha: "file1sha",
                                filename: "file1.ts",
                                status: "modified",
                                additions: 5,
                                deletions: 2
                            }
                        ]
                    })),
                    listReviews: mock(() => Promise.resolve({data: []})),
                    listReviewComments: mock(() => Promise.resolve({data: []}))
                }
            }
        } as unknown as Octokits;
    };

    const branchInfo: BranchInfo = {
        baseBranch: "main",
        workingBranch: "feature",
        isNewBranch: true
    };

    beforeEach(() => {
        (core.setOutput as any).mockClear();
    });

    describe("with user prompt", () => {
        test("should set textTask from inputs.prompt", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Do something"
                },
                payload: {
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text.trim()).toBe("Do something");
            expect(core.setOutput).toHaveBeenCalledWith("EJ_TASK", expect.any(String));
        });
    });

    describe("issue comment event (not on PR)", () => {
        test("should format issue comment prompt", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: false
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("User @commenter mentioned you");
            expect(result.textTask?.text).toContain("#123 Test Issue");
            expect(result.textTask?.text).toContain("@junie help");
            expect(result.textTask?.text).toContain("### ISSUE:");
        });
    });

    describe("issues event", () => {
        test("should format issue prompt", async () => {
            const context = createMockContext({
                eventName: "issues",
                payload: {
                    action: "opened",
                    issue: {
                        number: 123,
                        title: "Test Issue",
                        body: "Issue body",
                        state: "open",
                        user: {login: "author"}
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("### ISSUE:");
            expect(result.textTask?.text).toContain("Test Issue");
        });
    });

    describe("PR comment event", () => {
        test("should format PR comment prompt with all details", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                payload: {
                    action: "created",
                    issue: {
                        number: 123,
                        title: "Test PR",
                        body: "PR body",
                        state: "open",
                        user: {login: "author"},
                        pull_request: {url: "https://api.github.com/repos/owner/repo/pulls/123"}
                    },
                    comment: {
                        id: 1,
                        body: "Please fix this",
                        user: {login: "reviewer"}
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("User @reviewer mentioned you in the comment on pull request");
            expect(result.textTask?.text).toContain("Please fix this");
            expect(result.textTask?.text).toContain("### PULL REQUEST CONTEXT:");
            expect(result.textTask?.text).toContain("### CHANGED FILES:");
        });
    });

    describe("PR review event", () => {
        test("should format PR review prompt", async () => {
            const context = createMockContext({
                eventName: "pull_request_review",
                payload: {
                    action: "submitted",
                    pull_request: {
                        number: 123,
                        title: "Test PR"
                    },
                    review: {
                        id: 456,
                        user: {login: "reviewer"},
                        body: "Changes needed"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("User @reviewer mentioned you in the review on pull request");
        });
    });

    describe("PR review comment event", () => {
        test("should format PR review comment prompt", async () => {
            const context = createMockContext({
                eventName: "pull_request_review_comment",
                payload: {
                    action: "created",
                    pull_request: {
                        number: 123,
                        title: "Test PR"
                    },
                    comment: {
                        id: 1,
                        body: "Fix this line",
                        user: {login: "reviewer"}
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("User @reviewer mentioned you in the review comment on pull request");
            expect(result.textTask?.text).toContain("Fix this line");
        });
    });

    describe("PR event", () => {
        test("should format PR prompt for opened/edited PR", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                payload: {
                    action: "opened",
                    pull_request: {
                        number: 123,
                        title: "Test PR",
                        body: "PR description",
                        state: "open",
                        user: {login: "author"}
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.textTask).toBeDefined();
            expect(result.textTask?.text).toContain("### PULL REQUEST CONTEXT:");
            expect(result.textTask?.text).toContain("### PULL REQUEST:");
        });
    });

    describe("merge task", () => {
        test("should set mergeTask when resolveConflicts input is true", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    resolveConflicts: true
                }
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.mergeTask).toBeDefined();
            expect(result.mergeTask?.branch).toBe("main");
            expect(result.mergeTask?.type).toBe("merge");
        });

        test("should set mergeTask when comment has resolve trigger phrase", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                payload: {
                    action: "created",
                    issue: {
                        number: 123,
                        pull_request: {url: "https://api.github.com/repos/owner/repo/pulls/123"}
                    },
                    comment: {
                        id: 1,
                        body: "@junie resolve conflicts",
                        user: {login: "user"}
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.mergeTask).toBeDefined();
            expect(result.mergeTask?.branch).toBe("main");
            expect(result.mergeTask?.type).toBe("merge");
        });
    });

    describe("output", () => {
        test("should call core.setOutput with JSON stringified task", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Test prompt"
                },
                payload: {
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(core.setOutput).toHaveBeenCalledWith("EJ_TASK", JSON.stringify(result));
        });
    });

    describe("input size validation", () => {
        test("should validate input size after downloading attachments", async () => {
            const largePrompt = "a".repeat(25000); // Exceeds 19KB limit
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    prompt: largePrompt
                }
            });
            const octokit = createMockOctokit();

            // This should throw an error from validateInputSize
            await expect(prepareJunieTask(context, branchInfo, octokit)).rejects.toThrow();
        });
    });

    describe("integration", () => {
        test("should handle multiple event types in sequence", async () => {
            const octokit = createMockOctokit();

            // Test issue comment
            const issueContext = createMockContext({eventName: "issue_comment", isPR: false});
            const issueResult = await prepareJunieTask(issueContext, branchInfo, octokit);
            expect(issueResult.textTask).toBeDefined();

            // Test PR comment
            const prContext = createMockContext({eventName: "issue_comment", isPR: true});
            const prResult = await prepareJunieTask(prContext, branchInfo, octokit);
            expect(prResult.textTask).toBeDefined();

            // Both should have been processed successfully
            expect(core.setOutput).toHaveBeenCalledTimes(2);
        });
    });
});
