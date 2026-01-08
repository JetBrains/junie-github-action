import {describe, test, expect} from "bun:test";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {JunieExecutionContext} from "../context";
import {FetchedData, GraphQLPullRequest, GraphQLIssue} from "../api/queries";

describe("NewGitHubPromptFormatter", () => {
    const formatter = new NewGitHubPromptFormatter();

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

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<repository>");
        expect(prompt).toContain("Repository: test-owner/test-repo");
        expect(prompt).toContain("Owner: test-owner");
        expect(prompt).toContain("</repository>");
    });

    test("generatePrompt includes actor info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<actor>");
        expect(prompt).toContain("Triggered by: @test-user");
        expect(prompt).toContain("Event: pull_request (opened)");
        expect(prompt).toContain("</actor>");
    });

    test("generatePrompt includes PR info when available", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<pull_request_info>");
        expect(prompt).toContain("Number: #1");
        expect(prompt).toContain("Title: Test PR");
        expect(prompt).toContain("Author: @test-author");
        expect(prompt).toContain("State: OPEN");
        expect(prompt).toContain("Branch: feature -> main");
        expect(prompt).toContain("</pull_request_info>");
    });

    test("generatePrompt includes commits info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<commits>");
        expect(prompt).toContain("abc123");
        expect(prompt).toContain("First commit");
        expect(prompt).toContain("def456");
        expect(prompt).toContain("Second commit");
        expect(prompt).toContain("</commits>");
    });

    test("generatePrompt includes changed files info", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<changed_files>");
        expect(prompt).toContain("file1.ts (modified) +5/-2");
        expect(prompt).toContain("file2.ts (added) +5/-3");
        expect(prompt).toContain("</changed_files>");
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

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<issue_info>");
        expect(prompt).toContain("Number: #1");
        expect(prompt).toContain("Title: Test Issue");
        expect(prompt).toContain("Author: @test-author");
        expect(prompt).toContain("</issue_info>");
    });

    test("generatePrompt includes custom prompt", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};
        const customPrompt = "Please fix this bug";

        const prompt = await formatter.generatePrompt(context, fetchedData, customPrompt);

        expect(prompt).toContain("<user_instruction>");
        expect(prompt).toContain("Please fix this bug");
        expect(prompt).toContain("</user_instruction>");
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

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<timeline>");
        expect(prompt).toContain("Comment by @commenter");
        expect(prompt).toContain("Test comment");
        expect(prompt).toContain("</timeline>");
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

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).toContain("<reviews>");
        expect(prompt).toContain("Review by @reviewer (APPROVED)");
        expect(prompt).toContain("Looks good!");
        expect(prompt).toContain("</reviews>");
    });

    test("generatePrompt omits empty sections", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {};

        const prompt = await formatter.generatePrompt(context, fetchedData);

        expect(prompt).not.toContain("<timeline>");
        expect(prompt).not.toContain("<reviews>");
        expect(prompt).not.toContain("<changed_files>");
        expect(prompt).not.toContain("<commits>");
    });

    test("generatePrompt returns only custom prompt when attachGithubContext is false", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };
        const customPrompt = "Please fix this specific bug";

        const prompt = await formatter.generatePrompt(context, fetchedData, customPrompt, false);

        // Should contain only the custom prompt
        expect(prompt).toBe("Please fix this specific bug");

        // Should NOT contain any GitHub context
        expect(prompt).not.toContain("<repository>");
        expect(prompt).not.toContain("<actor>");
        expect(prompt).not.toContain("<pull_request_info>");
        expect(prompt).not.toContain("<commits>");
        expect(prompt).not.toContain("<changed_files>");
    });

    test("generatePrompt includes GitHub context when attachGithubContext is true with custom prompt", async () => {
        const context = createMockContext();
        const fetchedData: FetchedData = {
            pullRequest: createMockPR()
        };
        const customPrompt = "Please review this PR";

        const prompt = await formatter.generatePrompt(context, fetchedData, customPrompt, true);

        // Should contain custom prompt
        expect(prompt).toContain("Please review this PR");

        // Should also contain GitHub context
        expect(prompt).toContain("<repository>");
        expect(prompt).toContain("<actor>");
        expect(prompt).toContain("<pull_request_info>");
        expect(prompt).toContain("<commits>");
        expect(prompt).toContain("<changed_files>");
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

        const prompt = await formatter.generatePrompt(context, fetchedData, undefined, true);

        // Should contain PR body as user instruction
        expect(prompt).toContain("PR description from GitHub");

        // Should contain GitHub context
        expect(prompt).toContain("<repository>");
        expect(prompt).toContain("<actor>");
        expect(prompt).toContain("<pull_request_info>");
    });
});
