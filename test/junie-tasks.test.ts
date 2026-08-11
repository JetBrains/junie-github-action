import {describe, test, expect, mock, beforeEach, beforeAll, afterAll} from "bun:test";
import {prepareJunieTask} from "../src/github/junie/junie-tasks";
import {JunieExecutionContext} from "../src/github/context";
import {BranchInfo} from "../src/github/operations/branch";
import {Octokits} from "../src/github/api/client";
import * as core from "@actions/core";
import {execSync} from "child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock modules
mock.module("@actions/core", () => ({
    setOutput: mock(() => {}),
}));

mock.module("../src/github/junie/attachment-downloader", () => ({
    downloadAttachmentsAndRewriteText: mock((text: string) => Promise.resolve(text)),
}));

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

    // Goal-mode runs excludes the agent's artifacts via `.git/info/exclude` of the
    // repository they run in. Run from a throwaway repository so these tests do not
    // write to this checkout's own git directory.
    let originalCwd: string;
    let scratchRepo: string;

    beforeAll(() => {
        originalCwd = process.cwd();
        scratchRepo = fs.mkdtempSync(path.join(os.tmpdir(), "junie-tasks-test-"));
        execSync("git init -q", {cwd: scratchRepo});
        process.chdir(scratchRepo);
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(scratchRepo, {recursive: true, force: true});
    });

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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("Do something");
            expect(result.orchestratedTask?.task).toContain("<repository>");
            expect(result.orchestratedTask?.task).toContain("<actor>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("Do something");
            expect(result.orchestratedTask?.task).toContain("Do NOT commit or push changes");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("@junie-agent help");
            expect(result.orchestratedTask?.task).toContain("<repository>");
            expect(result.orchestratedTask?.task).toContain("<actor>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("Issue body");
            expect(result.orchestratedTask?.task).toContain("<repository>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("Please fix this");
            expect(result.orchestratedTask?.task).toContain("<repository>");
            expect(result.orchestratedTask?.task).toContain("<pull_request_info>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("Changes needed");
            expect(result.orchestratedTask?.task).toContain("<repository>");
        });

        test("should create codeReviewTask when code-review prompt is provided", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                isPR: true,
                entityNumber: 123,
                inputs: {
                    prompt: "code-review"
                },
                payload: {
                    pull_request: {
                        number: 123,
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

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result).toBeDefined();
            expect(result.codeReviewTask).toBeDefined();
            expect(result.codeReviewTask?.diffCommand).toContain("git diff origin/main");
            expect(result.codeReviewTask?.description).toContain("<pull_request_info>");
            // Header should NOT contain "Your task is to:"
            expect(result.codeReviewTask?.description).toContain("You were triggered as a GitHub AI Assistant by pull_request action.");
            expect(result.codeReviewTask?.description).not.toContain("Your task is to:");
            // For code review, user_instruction should not be attached at all
            expect(result.codeReviewTask?.description).not.toContain("<user_instruction>");
            expect(result.codeReviewTask?.description).not.toContain("code-review");
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
            expect(result.codeReviewTask).toBeDefined();
            // Should detect code-review trigger from comment and create codeReviewTask
            expect(result.codeReviewTask?.diffCommand).toContain("git diff origin/main");
            expect(result.codeReviewTask?.description).toContain("<pull_request_info>");
            // Header should NOT contain "Your task is to:"
            expect(result.codeReviewTask?.description).toContain("You were triggered as a GitHub AI Assistant by pull_request_review action.");
            expect(result.codeReviewTask?.description).not.toContain("Your task is to:");
            // For code review, user_instruction should not be attached
            expect(result.codeReviewTask?.description).not.toContain("<user_instruction>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("Fix this line");
            expect(result.orchestratedTask?.task).toContain("<repository>");
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
            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
            expect(result.mergeTask).toBeUndefined();
            expect(result.orchestratedTask?.task).toContain("<user_instruction>");
            expect(result.orchestratedTask?.task).toContain("PR description");
            expect(result.orchestratedTask?.task).toContain("<pull_request_info>");
            expect(result.orchestratedTask?.task).toContain("<repository>");
        });
    });

    describe("goal mode", () => {
        test("should keep the agent from publishing, so the action decides where changes land", async () => {
            const context = createMockContext({eventName: "issue_comment", isPR: true});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("Do NOT push to the remote");
            expect(task).toContain("do NOT create or update a pull request");
            expect(task).toContain("Do NOT create git worktrees");
        });

        // The note must state whatever branch.ts already decided, for every outcome its
        // rules can produce — the parameter, the PR author / token owner shortcuts, the
        // closed-PR case and silent mode alike.
        test("should pin the agent to the existing PR branch when branch.ts kept it", async () => {
            const context = createMockContext({eventName: "issue_comment", isPR: true});
            const octokit = createMockOctokit();

            // create_new_branch_for_pr disabled, or actor is the PR author / token owner.
            const existingPrBranch: BranchInfo = {
                baseBranch: "main",
                workingBranch: "contributor-feature",
                isNewBranch: false
            };

            const result = await prepareJunieTask(context, existingPrBranch, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("Branch 'contributor-feature' is checked out");
            expect(task).toContain("'contributor-feature' is the branch of the pull request this run targets");
            expect(task).toContain("do NOT open a new pull request under any circumstances");
        });

        test("should pin the agent to the new branch when branch.ts created one", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            // create_new_branch_for_pr enabled, an external contributor, or an issue run.
            const freshBranch: BranchInfo = {
                baseBranch: "main",
                workingBranch: "junie/issue-123-456",
                isNewBranch: true
            };

            const result = await prepareJunieTask(context, freshBranch, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("Branch 'junie/issue-123-456' is checked out");
            expect(task).toContain("opens a new pull request from it once you finish");
            expect(task).toContain("Do NOT open that pull request yourself");
        });

        test("should not claim a pull request exists on a silent-mode issue run", async () => {
            const context = createMockContext({eventName: "issues", isPR: false});
            const octokit = createMockOctokit();

            // Silent mode leaves the base branch checked out and never creates a branch.
            const silentModeBranch: BranchInfo = {
                baseBranch: "main",
                workingBranch: "main",
                isNewBranch: false
            };

            const result = await prepareJunieTask(context, silentModeBranch, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("Branch 'main' is checked out");
            expect(task).toContain("The workflow decides what to publish");
            expect(task).not.toContain("the branch of the pull request this run targets");
        });

        test("should forbid creating branches and opening PRs in every branch mode", async () => {
            const octokit = createMockOctokit();
            const modes: BranchInfo[] = [
                {baseBranch: "main", workingBranch: "existing-pr-branch", isNewBranch: false},
                {baseBranch: "main", workingBranch: "junie/issue-1-2", isNewBranch: true},
            ];

            for (const mode of modes) {
                const result = await prepareJunieTask(
                    createMockContext({eventName: "issue_comment", isPR: true}), mode, octokit);

                const task = result.orchestratedTask?.task ?? "";
                expect(task).toContain("do NOT create or update a pull request");
                expect(task).toContain("Do NOT create, switch to or rename a branch");
                expect(task).toContain(`'${mode.workingBranch}'`);
            }
        });

        test("should forbid retitling or editing an existing pull request", async () => {
            const context = createMockContext({eventName: "issue_comment", isPR: true});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("its title, description, labels, reviewers");
            expect(task).toContain("must be left exactly as they are");
            expect(task).toContain("Do NOT rename, retitle, reword");
        });

        test("should require a descriptive task name for the pull request title", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("the workflow titles the pull request from the issue");
            expect(task).toContain("It names the CHANGE, not your work on it");
            expect(task).toContain("the change or the business value it delivers");
            expect(task).toContain("Add export functionality to users module");
            expect(task).toContain("Fix NPE in payment processing");
        });

        test("should ban internal workflow phrasing from the task name", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            const banned = [
                "Step", "Stage", "Review", "Implementation",
                "Validation", "Validation Completeness", "Deliverables",
                "Task execution", "Orchestrated", "Final report",
            ];
            for (const phrase of banned) {
                expect(task).toContain(`'${phrase}'`);
            }
        });

        test("should tell every step to name the change, not the step it just finished", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            // taskName is last-writer-wins across sub-agents, so the rule has to bind each
            // report, not just the final one.
            expect(task).toContain("at any point, from any step or sub-agent");
            expect(task).toContain("Never name the step you just finished");
            expect(task).toContain("Review Step 1 Implementation and Validation Completeness");
        });

        test("should tell the agent not to add the title prefix itself", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.orchestratedTask?.task)
                .toContain("Do NOT prefix it with '[Junie]:'");
        });

        test("should tell the agent not to commit its plan file", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.orchestratedTask?.task).toContain("Do not stage or commit your plan file");
        });

        test("should ask for a short summary, so the PR description keeps its shape", async () => {
            const context = createMockContext({eventName: "issues"});
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            const task = result.orchestratedTask?.task ?? "";
            expect(task).toContain("Final summary format");
            expect(task).toContain("A few sentences");
        });

        test("should not use goal mode for a minor fix", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "minor-fix"
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

            expect(result.task).toBeDefined();
            expect(result.orchestratedTask).toBeUndefined();
        });

        test("should not use goal mode for a push event", async () => {
            const context = createMockContext({
                eventName: "push",
                payload: {
                    ref: "refs/heads/main",
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.task).toBeDefined();
            expect(result.orchestratedTask).toBeUndefined();
        });

        test("should export the PR title on a fix-ci run, whose payload has no entity", async () => {
            // workflow_run payloads carry only workflow_run.pull_requests[].number, so without
            // this the results step has no title and falls back to a generic one.
            const context = createMockContext({
                eventName: "workflow_run" as any,
                isPR: true,
                entityNumber: 123,
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "fix-ci"
                },
                payload: {
                    action: "completed",
                    workflow_run: {
                        id: 12345,
                        name: "CI",
                        head_branch: "feature-branch",
                        head_sha: "abc123",
                        conclusion: "failure",
                        pull_requests: [{number: 123}]
                    },
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            await prepareJunieTask(context, branchInfo, octokit);

            expect(core.setOutput).toHaveBeenCalledWith("ENTITY_TITLE", "Test PR");
        });

        test("should export the Jira issue summary as the entity title", async () => {
            // A Jira dispatch runs in goal mode but has no GitHub entity to fetch a title from,
            // so without reading the payload the PR would be named after a sub-agent's step.
            const context = createMockContext({
                eventName: "workflow_dispatch" as any,
                isPR: false,
                entityNumber: undefined,
                payload: {
                    action: "jira_event",
                    issueKey: "PROJ-42",
                    issueSummary: "Users cannot export their data",
                    issueDescription: "The export button does nothing",
                    comments: [],
                    attachments: [],
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            await prepareJunieTask(context, branchInfo, octokit);

            expect(core.setOutput).toHaveBeenCalledWith("ENTITY_TITLE", "Users cannot export their data");
        });

        test("should export the YouTrack issue title as the entity title", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch" as any,
                isPR: false,
                entityNumber: undefined,
                payload: {
                    action: "youtrack_event",
                    issueId: "PROJ-7",
                    issueUrl: "https://youtrack.example.com/issue/PROJ-7",
                    issueTitle: "Add CSV export to the users module",
                    issueDescription: "Support exporting the user list",
                    youtrackBaseUrl: "https://youtrack.example.com",
                    youtrackToken: "token",
                    repository: {
                        owner: {login: "owner"},
                        name: "repo"
                    }
                } as any
            });
            const octokit = createMockOctokit();

            await prepareJunieTask(context, branchInfo, octokit);

            expect(core.setOutput).toHaveBeenCalledWith("ENTITY_TITLE", "Add CSV export to the users module");
        });

        test("should use goal mode for a fix-ci run", async () => {
            const context = createMockContext({
                eventName: "workflow_run" as any,
                isPR: true,
                entityNumber: 123,
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "fix-ci"
                },
                payload: {
                    action: "completed",
                    workflow_run: {
                        id: 12345,
                        name: "CI",
                        head_branch: "feature-branch",
                        head_sha: "abc123",
                        conclusion: "failure",
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

            expect(result.orchestratedTask).toBeDefined();
            expect(result.task).toBeUndefined();
        });

        test("should not use goal mode for a code review", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                isPR: true,
                entityNumber: 123,
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "code-review"
                },
                payload: {
                    pull_request: {
                        number: 123,
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

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.codeReviewTask).toBeDefined();
            expect(result.orchestratedTask).toBeUndefined();
        });

        test("should not use goal mode when resolving conflicts", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    resolveConflicts: true
                }
            });
            const octokit = createMockOctokit();

            const result = await prepareJunieTask(context, branchInfo, octokit);

            expect(result.mergeTask).toBeDefined();
            expect(result.orchestratedTask).toBeUndefined();
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
        });
    });

    describe("integration", () => {
        test("should handle multiple event types in sequence", async () => {
            const octokit = createMockOctokit();

            // Test issue comment
            const issueContext = createMockContext({eventName: "issue_comment", isPR: false});
            const issueResult = await prepareJunieTask(issueContext, branchInfo, octokit);
            expect(issueResult).toBeDefined();
            expect(issueResult.orchestratedTask).toBeDefined();
            expect(issueResult.mergeTask).toBeUndefined();

            // Test PR comment
            const prContext = createMockContext({eventName: "issue_comment", isPR: true});
            const prResult = await prepareJunieTask(prContext, branchInfo, octokit);
            expect(prResult).toBeDefined();
            expect(prResult.orchestratedTask).toBeDefined();
            expect(prResult.mergeTask).toBeUndefined();

            // Both should have been processed successfully
            // Each call to prepareJunieTask makes 2 setOutput calls (JUNIE_INPUT_FILE, CUSTOM_JUNIE_ARGS)
            expect(core.setOutput).toHaveBeenCalledTimes(4);
        });
    });
});
