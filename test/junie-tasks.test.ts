import {describe, test, expect, mock, beforeEach} from "bun:test";
import {prepareJunieTask} from "../src/github/junie/junie-tasks";
import {JunieExecutionContext} from "../src/github/context";
import {BranchInfo} from "../src/github/operations/branch";
import {Octokits} from "../src/github/api/client";
import * as core from "@actions/core";
import * as fs from "node:fs";

// Mock modules
mock.module("@actions/core", () => ({
    setOutput: mock(() => {}),
}));

mock.module("../src/github/junie/attachment-downloader", () => ({
    downloadAttachmentsAndRewriteText: mock((text: string) => Promise.resolve(text)),
}));

/**
 * The input schema the Junie CLI accepts, mirrored from the CLI sources: `CliInput` and
 * `CliCodeReviewTask` (api/Input.kt) and `ReviewTarget` (attachments/ReviewTarget.kt).
 * The CLI decodes the input strictly, so a single unknown key or an unknown `reviewTarget.type`
 * aborts the whole run with "Cannot parse input JSON" before any task starts.
 */
const CLI_INPUT_KEYS = [
    "codeReviewTask",
    "debugTask",
    "mergeTask",
    "orchestratedTask",
    "rebaseTask",
    "sessionId",
    "task"
];

const CODE_REVIEW_TASK_KEYS = [
    "description",
    "diffCommand",
    "fetchVcsInfo",
    // Deprecated on the CLI side: superseded by reviewTarget, which also selects the comment
    // channel. Sending it switches the review back to the external MCP comment tool.
    "includeInlineCommentToolInstructions",
    "reviewTarget"
];

const REVIEW_TARGET_TYPES = ["localChanges", "remoteRequest"];

/** The keys the action is expected to send for a code review, in the order `sort()` produces. */
const EXPECTED_CODE_REVIEW_TASK_KEYS = ["description", "diffCommand", "fetchVcsInfo", "reviewTarget"];

/** Asserts the payload carries nothing the CLI's strict parser would reject. */
const expectParseableByJunieCli = (input: Record<string, any>) => {
    for (const key of Object.keys(input)) {
        expect(CLI_INPUT_KEYS).toContain(key);
    }

    if (input.mergeTask) {
        expect(Object.keys(input.mergeTask)).toEqual(["branch"]);
        expect(typeof input.mergeTask.branch).toBe("string");
    }

    const codeReviewTask = input.codeReviewTask;
    if (codeReviewTask) {
        for (const key of Object.keys(codeReviewTask)) {
            expect(CODE_REVIEW_TASK_KEYS).toContain(key);
        }

        const reviewTarget = codeReviewTask.reviewTarget;
        if (reviewTarget) {
            expect(REVIEW_TARGET_TYPES).toContain(reviewTarget.type);
            if (reviewTarget.type === "remoteRequest") {
                expect(Object.keys(reviewTarget).sort()).toEqual(["number", "type"]);
                // Parsed into a Kotlin Int, so a float or a stringified number fails the parser
                expect(Number.isInteger(reviewTarget.number)).toBe(true);
            }
        }
    }
};

/** Reads back the file the CLI is actually fed, instead of the object `prepareJunieTask` returns. */
const readJunieInputFile = (): Record<string, any> =>
    JSON.parse(fs.readFileSync(`${process.env.WORKING_DIR}/junie_input.json`, "utf-8"));

describe("prepareJunieTask", () => {
    const createMockContext = (overrides: Partial<JunieExecutionContext> = {}): JunieExecutionContext => {
        const defaultInputs = {
            resolveConflicts: false,
            createNewBranchForPR: false,
            silentMode: false,
            useSingleComment: false,
            attachGithubContextToCustomPrompt: true,
            junieWorkingDir: "/tmp",
            appToken: "token",
            prompt: "",
            triggerPhrase: "@junie-agent",
            assigneeTrigger: "",
            labelTrigger: "",
            allowedMcpServers: ""
        };

        const { inputs: _, ...restOverrides } = overrides;

        return {
            eventName: "issue_comment",
            runId: "123",
            actor: "testuser",
            actorEmail: "test@example.com",
            tokenOwner: "user",
            isPR: false,
            inputs: overrides.inputs ? { ...defaultInputs, ...overrides.inputs } : defaultInputs,
            payload: {
                action: "created",
                issue: {
                    number: 123,
                    title: "Test Issue",
                    body: "Issue body",
                    state: "open",
                    user: {login: "author"},
                    updated_at: "2024-01-01T00:00:00Z"
                },
                comment: {
                    id: 1,
                    body: "@junie-agent help",
                    user: {login: "commenter"},
                    created_at: "2024-01-01T00:00:00Z"
                },
                repository: {
                    owner: {login: "owner"},
                    name: "repo"
                }
            } as any,
            ...restOverrides
        } as JunieExecutionContext;
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
                                lastEditedAt: null,
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
                                            lastEditedAt: null,
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
                                lastEditedAt: null,
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
        // Set WORKING_DIR for file operations
        const workingDir = "/tmp/junie-test";
        process.env.WORKING_DIR = workingDir;
        // Create directory if it doesn't exist
        if (!fs.existsSync(workingDir)) {
            fs.mkdirSync(workingDir, { recursive: true });
        }
    });

    describe("with user prompt", () => {
        test("should set task from inputs.prompt with GitHub context by default", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Do something"
                },
                payload: {
                    repository: {
                        owner: {login: "owner"},
                        name: "repo",
                        full_name: "owner/repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.task).toContain("Do something");
            expect(result.task).toContain("<repository>");
            expect(result.task).toContain("<actor>");
            expect(result.mergeTask).toBeUndefined();
            expect(core.setOutput).toHaveBeenCalledWith("JUNIE_INPUT_FILE", expect.any(String));
        });

        test("should set task from inputs.prompt without GitHub context when disabled", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Do something",
                    attachGithubContextToCustomPrompt: false
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

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.task).toContain("Do something");
            expect(result.task).toContain("Do NOT commit or push changes");
            expect(result.mergeTask).toBeUndefined();
            expect(core.setOutput).toHaveBeenCalledWith("JUNIE_INPUT_FILE", expect.any(String));
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

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("@junie-agent help");
            expect(result.task).toContain("<repository>");
            expect(result.task).toContain("<actor>");
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
                        user: {login: "author"},
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("Issue body");
            expect(result.task).toContain("<repository>");
        });
    });

    describe("PR comment event", () => {
        test("should format PR comment prompt with all details", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                entityNumber: 123,
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
                        user: {login: "reviewer"},
                        created_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("Please fix this");
            expect(result.task).toContain("<repository>");
            expect(result.task).toContain("<pull_request_info>");
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
                        title: "Test PR",
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    review: {
                        id: 456,
                        user: {login: "reviewer"},
                        body: "Changes needed",
                        submitted_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("Changes needed");
            expect(result.task).toContain("<repository>");
        });

        test("should create codeReviewTask when code-review prompt is provided", async () => {
            // Deliberately different from the default entity number: the review target
            // must carry the number of the reviewed PR, not a hardcoded value
            const prNumber = 4242;
            const context = createMockContext({
                eventName: "pull_request",
                isPR: true,
                entityNumber: prNumber,
                inputs: {
                    prompt: "code-review"
                },
                payload: {
                    pull_request: {
                        number: prNumber,
                        title: "Test PR",
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            // Inline comments are posted by the CLI itself, so the inline comment MCP server
            // must not be advertised in the prompt anymore even when it is enabled
            const result = await prepareJunieTask(context, branchInfo, octokit, ["mcp_github_inline_comment_server"]);

            expect(result).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.codeReviewTask).toBeDefined();
            // The Junie CLI parses the whole input strictly and rejects it on unknown fields,
            // so the exact set of keys is part of the contract, not an implementation detail
            expect(Object.keys(result.codeReviewTask!).sort()).toEqual(EXPECTED_CODE_REVIEW_TASK_KEYS);
            // reviewTarget alone must select the comment channel: the deprecated flag would
            // pin the review to the external MCP comment tool instead of the CLI's own one
            expect(result.codeReviewTask).not.toHaveProperty("includeInlineCommentToolInstructions");
            // The base ref the CLI derives from the command must stay resolvable
            expect(result.codeReviewTask?.diffCommand).toContain("git diff origin/main");
            expect(result.codeReviewTask?.fetchVcsInfo).toBe(true);
            expect(result.codeReviewTask?.reviewTarget).toEqual({type: "remoteRequest", number: prNumber});
            expect(result.codeReviewTask?.description).toContain("<pull_request_info>");
            // Header should NOT contain "Your task is to:"
            expect(result.codeReviewTask?.description).toContain("You were triggered as a GitHub AI Assistant by pull_request action.");
            expect(result.codeReviewTask?.description).not.toContain("Your task is to:");
            // For code review, user_instruction should not be attached at all
            expect(result.codeReviewTask?.description).not.toContain("<user_instruction>");
            expect(result.codeReviewTask?.description).not.toContain("code-review");
            expect(result.codeReviewTask?.description).not.toContain("post_inline_review_comment");

            // The CLI reads the task from the file, not from the returned object
            expect(core.setOutput).toHaveBeenCalledWith("JUNIE_INPUT_FILE", `${process.env.WORKING_DIR}/junie_input.json`);
            const writtenInput = readJunieInputFile();
            expect(writtenInput).toEqual(result);
            expectParseableByJunieCli(writtenInput);
        });

        test("should trigger codeReviewTask from comment when inputs.prompt is empty and code-review keyword is used", async () => {
            const context = createMockContext({
                eventName: "pull_request_review",
                eventAction: "submitted",  // Important: eventAction must be "submitted" or "edited"
                isPR: true,
                entityNumber: 123,
                inputs: {
                    prompt: ""  // Empty prompt - trigger comes from comment
                },
                payload: {
                    action: "submitted",
                    pull_request: {
                        number: 123,
                        title: "Test PR",
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    review: {
                        id: 456,
                        user: {login: "reviewer"},
                        body: "Please do code-review for this PR",
                        submitted_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.codeReviewTask).toBeDefined();
            // Should detect code-review trigger from comment and create codeReviewTask
            expect(Object.keys(result.codeReviewTask!).sort()).toEqual(EXPECTED_CODE_REVIEW_TASK_KEYS);
            expect(result.codeReviewTask?.diffCommand).toContain("git diff origin/main");
            expect(result.codeReviewTask?.fetchVcsInfo).toBe(true);
            expect(result.codeReviewTask?.reviewTarget).toEqual({type: "remoteRequest", number: 123});
            expect(result.codeReviewTask?.description).toContain("<pull_request_info>");
            // Header should NOT contain "Your task is to:"
            expect(result.codeReviewTask?.description).toContain("You were triggered as a GitHub AI Assistant by pull_request_review action.");
            expect(result.codeReviewTask?.description).not.toContain("Your task is to:");
            // For code review, user_instruction should not be attached
            expect(result.codeReviewTask?.description).not.toContain("<user_instruction>");

            const writtenInput = readJunieInputFile();
            expect(writtenInput).toEqual(result);
            expectParseableByJunieCli(writtenInput);
        });

        test("should fail to create codeReviewTask when PR number is not available", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch" as any,
                isPR: false,
                entityNumber: undefined,
                inputs: {
                    prompt: "code-review"
                },
                payload: {
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            await expect(prepareJunieTask(context, branchInfo, octokit)).rejects.toThrow(
                "Code review requires a Pull Request number"
            );
        });

        test("should not trigger fix CI prompt when workflow_run event has success conclusion", async () => {
            const context = createMockContext({
                eventName: "workflow_run" as any,
                isPR: true,
                entityNumber: 123,
                payload: {
                    action: "completed",
                    workflow_run: {
                        id: 12345,
                        name: "CI",
                        head_branch: "feature-branch",
                        head_sha: "abc123",
                        conclusion: "success",
                        pull_requests: [{number: 123}]
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            // Should NOT contain fix CI prompt since workflow succeeded
            expect(result.task).not.toContain("analyze CI failures and suggest fixes WITHOUT implementing them");
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
                        title: "Test PR",
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    comment: {
                        id: 1,
                        body: "Fix this line",
                        user: {login: "reviewer"},
                        created_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("Fix this line");
            expect(result.task).toContain("<repository>");
        });
    });

    describe("PR event", () => {
        test("should format PR prompt for opened/edited PR", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                isPR: true,
                entityNumber: 123,
                payload: {
                    action: "opened",
                    pull_request: {
                        number: 123,
                        title: "Test PR",
                        body: "PR description",
                        state: "open",
                        user: {login: "author"},
                        updated_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.task).toBeDefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.task).toContain("<user_instruction>");
            expect(result.task).toContain("PR description");
            expect(result.task).toContain("<pull_request_info>");
            expect(result.task).toContain("<repository>");
        });
    });

    describe("merge task", () => {
        test("should set merge task when resolveConflicts input is true", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    resolveConflicts: true
                }
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.mergeTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask?.branch).toBe("main");
            expectParseableByJunieCli(readJunieInputFile());
        });

        test("should set merge task when comment has resolve trigger phrase", async () => {
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
                        body: "@junie-agent resolve conflicts",
                        user: {login: "user"},
                        created_at: "2024-01-01T00:00:00Z"
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.mergeTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask?.branch).toBe("main");
            expectParseableByJunieCli(readJunieInputFile());
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

            expect(result).toBeDefined();
            expect(core.setOutput).toHaveBeenCalledWith("JUNIE_INPUT_FILE", expect.any(String));
            expect(core.setOutput).toHaveBeenCalledWith("CUSTOM_JUNIE_ARGS", expect.any(String));
            expectParseableByJunieCli(readJunieInputFile());
        });
    });

    describe("integration", () => {
        test("should handle multiple event types in sequence", async () => {
            const octokit = createMockOctokit();

            // Test issue comment
            const issueContext = createMockContext({eventName: "issue_comment", isPR: false});
            const issueResult = await prepareJunieTask(issueContext, branchInfo, octokit);
            expect(issueResult).toBeDefined();
            expect(issueResult.task).toBeDefined();
            expect(issueResult.mergeTask).toBeUndefined();

            // Test PR comment
            const prContext = createMockContext({eventName: "issue_comment", isPR: true});
            const prResult = await prepareJunieTask(prContext, branchInfo, octokit);
            expect(prResult).toBeDefined();
            expect(prResult.task).toBeDefined();
            expect(prResult.mergeTask).toBeUndefined();

            // Both should have been processed successfully
            // Each call to prepareJunieTask makes 2 setOutput calls (JUNIE_INPUT_FILE, CUSTOM_JUNIE_ARGS)
            expect(core.setOutput).toHaveBeenCalledTimes(4);
        });
    });
});
