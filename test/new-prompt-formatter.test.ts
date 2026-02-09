import {describe, test, expect} from "bun:test";
import {NewGitHubPromptFormatter} from "../src/github/junie/new-prompt-formatter";
import {JunieExecutionContext} from "../src/github/context";
import {FetchedData, GraphQLPullRequest, GraphQLIssue} from "../src/github/api/queries";
import {BranchInfo} from "../src/github/operations/branch";

describe("NewGitHubPromptFormatter", () => {
    const formatter = new NewGitHubPromptFormatter();

    const createMockBranchInfo = (): BranchInfo => ({
        baseBranch: "main",
        workingBranch: "feature",
        isNewBranch: false,
        prBaseBranch: "main"
    });

    const createMockContext = (overrides: Partial<JunieExecutionContext> = {}): JunieExecutionContext => ({
        runId: "123",
        workflow: "test",
        eventName: "pull_request",
        eventAction: "opened",
        actor: "test-user",
        actorEmail: "test@example.com",
        tokenOwner: {login: "test-owner", id: 123, type: "User"},
        entityNumber: 1,
        isPR: true,
        inputs: {
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
            labelTrigger: "junie",
            allowedMcpServers: ""
        },
        payload: {
            repository: {
                name: "test-repo",
                owner: {login: "test-owner"},
                full_name: "test-owner/test-repo"
            },
            pull_request: {
                number: 1,
                title: "Test PR",
                body: "Test body",
                updated_at: "2024-01-01T00:00:00Z"
            }
        } as any,
        ...overrides
    });

    const createMockPR = (): GraphQLPullRequest => ({
        number: 1,
        title: "Test PR",
        body: "Test PR body",
        bodyHTML: "<p>Test PR body</p>",
        state: "OPEN",
        url: "https://github.com/test/test/pull/1",
        author: {login: "test-author"},
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: "abc123def456",
        baseRefOid: "def456abc123",
        additions: 10,
        deletions: 5,
        changedFiles: 3,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        lastEditedAt: null,
        commits: {
            totalCount: 2,
            nodes: [
                {commit: {oid: "abc123", messageHeadline: "First commit", message: "First commit", committedDate: "2024-01-01T00:00:00Z"}},
                {commit: {oid: "def456", messageHeadline: "Second commit", message: "Second commit", committedDate: "2024-01-02T00:00:00Z"}}
            ]
        },
        files: {
            nodes: [
                {path: "file1.ts", additions: 5, deletions: 2, changeType: "MODIFIED"},
                {path: "file2.ts", additions: 5, deletions: 3, changeType: "ADDED"}
            ]
        },
        timelineItems: {
            nodes: []
        },
        reviews: {
            nodes: []
        }
    });

    const createMockIssue = (): GraphQLIssue => ({
        number: 1,
        title: "Test Issue",
        body: "Test issue body",
        bodyHTML: "<p>Test issue body</p>",
        state: "OPEN",
        url: "https://github.com/test/test/issues/1",
        author: {login: "test-author"},
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        lastEditedAt: null,
        timelineItems: {
            nodes: []
        }
    });

    test("generatePrompt includes repository info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<repository>");
        expect(result.prompt).toContain("Repository: test-owner/test-repo");
        expect(result.prompt).toContain("Owner: test-owner");
        expect(result.prompt).toContain("</repository>");
    });

    test("generatePrompt includes actor info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<actor>");
        expect(result.prompt).toContain("Triggered by: @test-user");
        expect(result.prompt).toContain("Event: pull_request (opened)");
        expect(result.prompt).toContain("</actor>");
    });

    test("generatePrompt includes PR info when available", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<pull_request_info>");
        expect(result.prompt).toContain("Number: #1");
        expect(result.prompt).toContain("Title: Test PR");
        expect(result.prompt).toContain("Author: @test-author");
        expect(result.prompt).toContain("State: OPEN");
        expect(result.prompt).toContain("Branch: feature -> main");
        expect(result.prompt).toContain("</pull_request_info>");
    });

    test("generatePrompt includes commits info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<commits>");
        expect(result.prompt).toContain("abc123");
        expect(result.prompt).toContain("First commit");
        expect(result.prompt).toContain("def456");
        expect(result.prompt).toContain("Second commit");
        expect(result.prompt).toContain("</commits>");
    });

    test("generatePrompt includes changed files info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<changed_files>");
        expect(result.prompt).toContain("file1.ts (modified) +5/-2");
        expect(result.prompt).toContain("file2.ts (added) +5/-3");
        expect(result.prompt).toContain("</changed_files>");
    });

    test("generatePrompt includes issue info when not a PR", async () => {
        const mockIssue = createMockIssue();
        const context = createMockContext({
            eventName: "issues",
            isPR: false,
            payload: {
                repository: {
                    name: "test-repo",
                    owner: {login: "test-owner"},
                    full_name: "test-owner/test-repo"
                },
                issue: {
                    number: 1,
                    title: "Test Issue",
                    body: "Test issue body",
                    updated_at: "2024-01-01T00:00:00Z"
                }
            } as any
        });
        const fetchedData: FetchedData = {
            issue: mockIssue
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<issue_info>");
        expect(result.prompt).toContain("Number: #1");
        expect(result.prompt).toContain("Title: Test Issue");
        expect(result.prompt).toContain("Author: @test-author");
        expect(result.prompt).toContain("</issue_info>");
    });

    test("generatePrompt includes custom prompt", async () => {
        const context = createMockContext({
            inputs: { ...createMockContext().inputs, prompt: "Please fix this bug" }
        });
        const fetchedData: FetchedData = {};

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<user_instruction>");
        expect(result.prompt).toContain("Please fix this bug");
        expect(result.prompt).toContain("</user_instruction>");
    });

    test("generatePrompt handles timeline comments", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: {
                ...createMockPR(),
                timelineItems: {
                    nodes: [
                        {
                            __typename: "IssueComment",
                            id: "1",
                            databaseId: 1,
                            body: "Test comment",
                            author: {login: "commenter"},
                            createdAt: "2024-01-03T00:00:00Z",
                            lastEditedAt: null,
                            url: "https://github.com/test/test/pull/1#issuecomment-1"
                        }
                    ]
                }
            }
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<timeline>");
        expect(result.prompt).toContain("Comment by @commenter");
        expect(result.prompt).toContain("Test comment");
        expect(result.prompt).toContain("</timeline>");
    });

    test("generatePrompt handles reviews", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: {
                ...createMockPR(),
                reviews: {
                    nodes: [
                        {
                            id: "1",
                            databaseId: 1,
                            author: {login: "reviewer"},
                            body: "Looks good!",
                            state: "APPROVED",
                            submittedAt: "2024-01-03T00:00:00Z",
                            lastEditedAt: null,
                            url: "https://github.com/test/test/pull/1#pullrequestreview-1",
                            comments: {nodes: []}
                        }
                    ]
                }
            }
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).toContain("<reviews>");
        expect(result.prompt).toContain("Review by @reviewer (APPROVED)");
        expect(result.prompt).toContain("Looks good!");
        expect(result.prompt).toContain("</reviews>");
    });

    test("generatePrompt omits empty sections", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        expect(result.prompt).not.toContain("<timeline>");
        expect(result.prompt).not.toContain("<reviews>");
        expect(result.prompt).not.toContain("<changed_files>");
        expect(result.prompt).not.toContain("<commits>");
    });

    test("generatePrompt returns only custom prompt when attachGithubContext is false", async () => {
        const context = createMockContext({
            inputs: { ...createMockContext().inputs, prompt: "Please fix this specific bug" }
        });
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), false);

        // Should contain the custom prompt + git operations note
        expect(result.prompt).toContain("Please fix this specific bug");
        expect(result.prompt).toContain("Do NOT commit or push changes");

        // Should NOT contain any GitHub context
        expect(result.prompt).not.toContain("<repository>");
        expect(result.prompt).not.toContain("<actor>");
        expect(result.prompt).not.toContain("<pull_request_info>");
        expect(result.prompt).not.toContain("<commits>");
        expect(result.prompt).not.toContain("<changed_files>");
    });

    test("generatePrompt includes GitHub context when attachGithubContext is true with custom prompt", async () => {
        const context = createMockContext({
            inputs: { ...createMockContext().inputs, prompt: "Please review this PR" }
        });
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true);

        // Should contain custom prompt
        expect(result.prompt).toContain("Please review this PR");

        // Should also contain GitHub context
        expect(result.prompt).toContain("<repository>");
        expect(result.prompt).toContain("<actor>");
        expect(result.prompt).toContain("<pull_request_info>");
        expect(result.prompt).toContain("<commits>");
        expect(result.prompt).toContain("<changed_files>");
    });

    test("generatePrompt includes GitHub context when attachGithubContext is true without custom prompt", async () => {
        const context = createMockContext({
            payload: {
                repository: {
                    name: "test-repo",
                    owner: {login: "test-owner"},
                    full_name: "test-owner/test-repo"
                },
                pull_request: {
                    number: 1,
                    title: "Test PR",
                    body: "PR description from GitHub",
                    updated_at: "2024-01-01T00:00:00Z"
                }
            } as any
        });
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true);

        // Should contain PR body as user instruction
        expect(result.prompt).toContain("PR description from GitHub");

        // Should contain GitHub context
        expect(result.prompt).toContain("<repository>");
        expect(result.prompt).toContain("<actor>");
        expect(result.prompt).toContain("<pull_request_info>");
    });

    test("generatePrompt formats review comments with thread structure", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: {
                ...createMockPR(),
                reviews: {
                    nodes: [
                        {
                            id: "review1",
                            databaseId: 1,
                            author: {login: "reviewer"},
                            body: "Some review comments",
                            state: "COMMENTED",
                            submittedAt: "2024-01-03T00:00:00Z",
                            lastEditedAt: null,
                            url: "https://github.com/test/test/pull/1#pullrequestreview-1",
                            comments: {
                                nodes: [
                                    {
                                        id: "comment1",
                                        databaseId: 1,
                                        body: "This needs improvement",
                                        path: "src/file.ts",
                                        position: 10,
                                        diffHunk: "@@ -1,3 +1,5 @@\n function test() {\n-  return 1;\n+  return 2;\n }",
                                        author: {login: "reviewer"},
                                        createdAt: "2024-01-03T10:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r1",
                                        replyTo: null
                                    },
                                    {
                                        id: "comment2",
                                        databaseId: 2,
                                        body: "I agree, let me explain why",
                                        path: "src/file.ts",
                                        position: 10,
                                        diffHunk: "@@ -1,3 +1,5 @@\n function test() {\n-  return 1;\n+  return 2;\n }",
                                        author: {login: "author"},
                                        createdAt: "2024-01-03T11:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r2",
                                        replyTo: {id: "comment1"}
                                    },
                                    {
                                        id: "comment3",
                                        databaseId: 3,
                                        body: "@junie-agent why did you decide this approach?",
                                        path: "src/file.ts",
                                        position: 10,
                                        diffHunk: "@@ -1,3 +1,5 @@\n function test() {\n-  return 1;\n+  return 2;\n }",
                                        author: {login: "author"},
                                        createdAt: "2024-01-03T12:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r3",
                                        replyTo: {id: "comment2"}
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        // Should contain the review section
        expect(result.prompt).toContain("<reviews>");
        expect(result.prompt).toContain("Review by @reviewer (COMMENTED)");
        expect(result.prompt).toContain("Review Comments:");

        // Should show the thread structure with file path and position
        expect(result.prompt).toContain("src/file.ts (position: 10):");

        // Should show all comments in thread order
        expect(result.prompt).toContain("@reviewer: This needs improvement");
        expect(result.prompt).toContain("@author: I agree, let me explain why");
        expect(result.prompt).toContain("@junie-agent why did you decide this approach?");

        // Verify the thread structure is preserved (replies come after parent)
        const reviewerCommentPos = result.prompt.indexOf("@reviewer: This needs improvement");
        const firstReplyPos = result.prompt.indexOf("@author: I agree, let me explain why");
        const secondReplyPos = result.prompt.indexOf("@junie-agent why did you decide this approach?");

        expect(reviewerCommentPos).toBeLessThan(firstReplyPos);
        expect(firstReplyPos).toBeLessThan(secondReplyPos);
    });

    test("generatePrompt formats multiple comment threads correctly", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: {
                ...createMockPR(),
                reviews: {
                    nodes: [
                        {
                            id: "review1",
                            databaseId: 1,
                            author: {login: "reviewer"},
                            body: "Review with multiple threads",
                            state: "COMMENTED",
                            submittedAt: "2024-01-03T00:00:00Z",
                            lastEditedAt: null,
                            url: "https://github.com/test/test/pull/1#pullrequestreview-1",
                            comments: {
                                nodes: [
                                    // First thread
                                    {
                                        id: "thread1-comment1",
                                        databaseId: 1,
                                        body: "First thread root comment",
                                        path: "src/file1.ts",
                                        position: 5,
                                        diffHunk: "@@ -1,1 +1,1 @@",
                                        author: {login: "reviewer"},
                                        createdAt: "2024-01-03T10:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r1",
                                        replyTo: null
                                    },
                                    {
                                        id: "thread1-comment2",
                                        databaseId: 2,
                                        body: "Reply to first thread",
                                        path: "src/file1.ts",
                                        position: 5,
                                        diffHunk: "@@ -1,1 +1,1 @@",
                                        author: {login: "author"},
                                        createdAt: "2024-01-03T11:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r2",
                                        replyTo: {id: "thread1-comment1"}
                                    },
                                    // Second thread
                                    {
                                        id: "thread2-comment1",
                                        databaseId: 3,
                                        body: "Second thread root comment",
                                        path: "src/file2.ts",
                                        position: 10,
                                        diffHunk: "@@ -2,2 +2,2 @@",
                                        author: {login: "reviewer"},
                                        createdAt: "2024-01-03T12:00:00Z",
                                        lastEditedAt: null,
                                        url: "https://github.com/test/test/pull/1#discussion_r3",
                                        replyTo: null
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        };

        const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

        // Should contain both file paths as separate threads
        expect(result.prompt).toContain("src/file1.ts (position: 5):");
        expect(result.prompt).toContain("src/file2.ts (position: 10):");

        // Should contain all comments
        expect(result.prompt).toContain("First thread root comment");
        expect(result.prompt).toContain("Reply to first thread");
        expect(result.prompt).toContain("Second thread root comment");

        // Verify thread separation: first thread should be complete before second thread
        const firstThreadRootPos = result.prompt.indexOf("First thread root comment");
        const firstThreadReplyPos = result.prompt.indexOf("Reply to first thread");
        const secondThreadRootPos = result.prompt.indexOf("Second thread root comment");

        expect(firstThreadRootPos).toBeLessThan(firstThreadReplyPos);
        expect(firstThreadReplyPos).toBeLessThan(secondThreadRootPos);
    });

    describe("junie-args extraction", () => {
        test("should extract junie-args from custom prompt", async () => {
            const context = createMockContext({
                inputs: { ...createMockContext().inputs, prompt: `Do something
junie-args: --model="gpt-5" --other="value"` }
            });
            const result = await formatter.generatePrompt(context, {}, createMockBranchInfo(), false);

            expect(result.customJunieArgs).toEqual(['--model="gpt-5"', '--other="value"']);
            expect(result.prompt).not.toContain('junie-args:');
            expect(result.prompt).toContain('Do something');
        });

        test("should extract junie-args from PR body", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                payload: {
                    ...createMockContext().payload,
                    pull_request: {
                        number: 1,
                        title: "Test PR",
                        body: `Fix the bug
junie-args: --model="claude-opus-4-5"`,
                        updated_at: "2024-01-01T00:00:00Z"
                    }
                } as any
            });

            const fetchedData: FetchedData = {
                pullRequest: createMockPR()
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            expect(result.customJunieArgs).toEqual(['--model="claude-opus-4-5"']);
            expect(result.prompt).not.toContain('junie-args:');
            expect(result.prompt).toContain('Fix the bug');
        });

        test("should extract junie-args from issue comment", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: false,
                payload: {
                    ...createMockContext().payload,
                    comment: {
                        id: 1,
                        body: `@junie-agent do something
junie-args: --model="gpt-5.2-codex" --temperature="0.7"`,
                        created_at: "2024-01-01T00:00:00Z"
                    },
                    issue: {
                        number: 1,
                        title: "Test Issue",
                        body: "Test body",
                        updated_at: "2024-01-01T00:00:00Z"
                    }
                } as any
            });

            const fetchedData: FetchedData = {
                issue: createMockIssue()
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            expect(result.customJunieArgs).toEqual(['--model="gpt-5.2-codex"', '--temperature="0.7"']);
            expect(result.prompt).not.toContain('junie-args:');
            expect(result.prompt).toContain('@junie-agent do something');
        });

        test("should handle multiple junie-args blocks", async () => {
            const context = createMockContext({
                inputs: { ...createMockContext().inputs, prompt: `First instruction
junie-args: --model="gpt-5"

Second instruction
junie-args: --other="value"` }
            });
            const result = await formatter.generatePrompt(context, {}, createMockBranchInfo(), false);

            expect(result.customJunieArgs).toEqual(['--model="gpt-5"', '--other="value"']);
            expect(result.prompt).not.toContain('junie-args:');
            expect(result.prompt).toContain('First instruction');
            expect(result.prompt).toContain('Second instruction');
        });

        test("should return empty array when no junie-args present", async () => {
            const context = createMockContext({
                inputs: { ...createMockContext().inputs, prompt: "Just a regular prompt without any args" }
            });
            const result = await formatter.generatePrompt(context, {}, createMockBranchInfo(), false);

            expect(result.customJunieArgs).toEqual([]);
            expect(result.prompt).toContain('Just a regular prompt without any args');
        });
    });

    describe("code-review and fix-ci keywords (refactoring validation)", () => {
        test("preserves junie-args when code-review is detected", async () => {
            const context = createMockContext({
                inputs: { ...createMockContext().inputs, prompt: "code-review junie-args: --model=\"gpt-5.2-codex\"" }
            });
            const fetchedData: FetchedData = { pullRequest: createMockPR() };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), false);

            expect(result.customJunieArgs).toContain('--model="gpt-5.2-codex"');
            expect(result.prompt).toContain("Read the Pull Request diff");
        });

        test("preserves junie-args when fix-ci is detected", async () => {
            const context = createMockContext({
                inputs: { ...createMockContext().inputs, prompt: "fix-ci junie-args: --model=\"gpt-5.2-codex\"" }
            });
            const fetchedData: FetchedData = { pullRequest: createMockPR() };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), false);

            expect(result.customJunieArgs).toContain('--model="gpt-5.2-codex"');
            expect(result.prompt).toContain("analyze CI failures");
        });

        test("uses branch name for diffPoint when not a PR", async () => {
            const context = createMockContext({
                isPR: false,
                entityNumber: 1,
                inputs: { ...createMockContext().inputs, prompt: "code-review" }
            });
            const branchInfo = createMockBranchInfo();
            branchInfo.prBaseBranch = undefined;
            branchInfo.baseBranch = "develop";
            const fetchedData: FetchedData = { issue: createMockIssue() };

            const result = await formatter.generatePrompt(context, fetchedData, branchInfo, false);

            expect(result.prompt).toContain("develop");
        });

        test("deduplicates junie-args keeping the last occurrence", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                entityNumber: 1,
                payload: {
                    ...createMockContext().payload,
                    comment: {
                        body: `Please fix this
junie-args: --model="gpt-4" --timeout=30 --model="claude-opus-4-5"`,
                        created_at: "2024-01-01T00:00:00Z"
                    }
                } as any
            });

            const fetchedData: FetchedData = {
                pullRequest: createMockPR()
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            // Should only have one --model, with the last value
            expect(result.customJunieArgs).toContain('--model="claude-opus-4-5"');
            expect(result.customJunieArgs).not.toContain('--model="gpt-4"');
            expect(result.customJunieArgs).toContain('--timeout=30');
            // Should have exactly 2 args, not 3
            expect(result.customJunieArgs.length).toBe(2);
        });

        test("does not extract junie-args from timeline or reviews", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                entityNumber: 1,
                payload: {
                    ...createMockContext().payload,
                    comment: {
                        body: `Fix the bug`,
                        created_at: "2024-01-01T00:00:00Z"
                    }
                } as any
            });

            const mockPR = createMockPR();
            // Add timeline with junie-args (should NOT be extracted)
            const fetchedData: FetchedData = {
                pullRequest: {
                    ...mockPR,
                    timelineItems: {
                        nodes: [
                            {
                                __typename: "IssueComment",
                                author: { login: "someuser" },
                                body: "Some comment with junie-args: --model=\"should-not-extract\"",
                                createdAt: "2024-01-01T00:00:00Z"
                            }
                        ]
                    },
                    reviews: {
                        nodes: [
                            {
                                author: { login: "reviewer" },
                                state: "COMMENTED",
                                submittedAt: "2024-01-01T00:00:00Z",
                                body: "Review with junie-args: --timeout=999",
                                comments: { nodes: [] }
                            }
                        ]
                    }
                }
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            // Should have no junie-args extracted from timeline/reviews
            expect(result.customJunieArgs.length).toBe(0);
            expect(result.customJunieArgs).not.toContain('--model="should-not-extract"');
            expect(result.customJunieArgs).not.toContain('--timeout=999');
            // But timeline content should still be in prompt (not cleaned)
            expect(result.prompt).toContain("Some comment with junie-args:");
        });
    });

    describe("Issue/PR body inclusion", () => {
        test("should include PR body when triggered by comment", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: true,
                payload: {
                    ...createMockContext().payload,
                    comment: {
                        body: "Please fix this @junie-agent"
                    }
                }
            });

            const fetchedData: FetchedData = {
                pullRequest: {
                    number: 1,
                    title: "Test PR",
                    body: "This is the PR description",
                    author: {login: "author"},
                    state: "OPEN",
                    headRefName: "feature",
                    baseRefName: "main",
                    baseRefOid: "abc123",
                    headRefOid: "def456",
                    additions: 10,
                    deletions: 5,
                    changedFiles: 2,
                    commits: {totalCount: 3, nodes: []}
                } as any
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            expect(result.prompt).toContain("This is the PR description");
            expect(result.prompt).toContain("Description:");
        });

        test("should NOT include PR body when triggered by PR event itself", async () => {
            const context = createMockContext({
                eventName: "pull_request",
                isPR: true,
                payload: {
                    ...createMockContext().payload,
                    pull_request: {
                        ...createMockContext().payload.pull_request,
                        body: "This is the PR description"
                    }
                }
            });

            const fetchedData: FetchedData = {
                pullRequest: {
                    number: 1,
                    title: "Test PR",
                    body: "This is the PR description",
                    author: {login: "author"},
                    state: "OPEN",
                    headRefName: "feature",
                    baseRefName: "main",
                    baseRefOid: "abc123",
                    headRefOid: "def456",
                    additions: 10,
                    deletions: 5,
                    changedFiles: 2,
                    commits: {totalCount: 3, nodes: []}
                } as any
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            // Body should be in user_instruction section, not in PR info
            expect(result.prompt).toContain("This is the PR description");
            // But should NOT have "Description:" label in PR info section
            const prInfoMatch = result.prompt.match(/<pull_request_info>[\s\S]*?<\/pull_request_info>/);
            if (prInfoMatch) {
                expect(prInfoMatch[0]).not.toContain("Description:");
            }
        });

        test("should include issue body when triggered by comment", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                isPR: false,
                payload: {
                    ...createMockContext().payload,
                    comment: {
                        body: "Please fix this @junie-agent"
                    }
                }
            });

            const fetchedData: FetchedData = {
                issue: {
                    number: 1,
                    title: "Test Issue",
                    body: "This is the issue description",
                    author: {login: "author"},
                    state: "OPEN"
                } as any
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            expect(result.prompt).toContain("This is the issue description");
            expect(result.prompt).toContain("Description:");
        });

        test("should NOT include issue body when triggered by issue event itself", async () => {
            const context = createMockContext({
                eventName: "issues",
                isPR: false,
                payload: {
                    ...createMockContext().payload,
                    issue: {
                        number: 1,
                        title: "Test Issue",
                        body: "This is the issue description",
                        author: {login: "author"},
                        state: "open"
                    }
                }
            });

            const fetchedData: FetchedData = {
                issue: {
                    number: 1,
                    title: "Test Issue",
                    body: "This is the issue description",
                    author: {login: "author"},
                    state: "OPEN"
                } as any
            };

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo());

            // Body should be in user_instruction section, not in issue info
            expect(result.prompt).toContain("This is the issue description");
            // But should NOT have "Description:" label in issue info section
            const issueInfoMatch = result.prompt.match(/<issue_info>[\s\S]*?<\/issue_info>/);
            if (issueInfoMatch) {
                expect(issueInfoMatch[0]).not.toContain("Description:");
            }
        });
    });

    describe("Workflow modification note", () => {
        test("should include WORKFLOW_MODIFICATION_NOTE when isDefaultToken is true", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Fix this bug"
                }
            });
            const fetchedData: FetchedData = {};

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true, true);

            expect(result.prompt).toContain("You CANNOT modify files in the `.github/` directory");
            expect(result.prompt).toContain("If changes to workflow files are required, you can only suggest them");
        });

        test("should NOT include WORKFLOW_MODIFICATION_NOTE when isDefaultToken is false", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Fix this bug"
                }
            });
            const fetchedData: FetchedData = {};

            const result = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true, false);

            expect(result.prompt).not.toContain("You CANNOT modify files in the `.github/` directory");
            expect(result.prompt).not.toContain("If changes to workflow files are required, you can only suggest them");
        });

        test("should always include GIT_OPERATIONS_NOTE regardless of token type", async () => {
            const context = createMockContext({
                inputs: {
                    ...createMockContext().inputs,
                    prompt: "Fix this bug"
                }
            });
            const fetchedData: FetchedData = {};

            const resultWithDefault = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true, true);
            const resultWithCustom = await formatter.generatePrompt(context, fetchedData, createMockBranchInfo(), true, false);

            expect(resultWithDefault.prompt).toContain("Do NOT commit or push changes");
            expect(resultWithCustom.prompt).toContain("Do NOT commit or push changes");
        });
    });
});
