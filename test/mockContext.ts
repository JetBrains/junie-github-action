import type {JunieExecutionContext} from "../src/github/context";
import type {
    IssueCommentEvent,
    IssuesEvent,
    PullRequestEvent,
    PullRequestReviewCommentEvent,
    PullRequestReviewEvent,
} from "@octokit/webhooks-types";

// Default input values
const defaultInputs = {
    resolveConflicts: false,
    createNewBranchForPR: false,
    silentMode: false,
    useSingleComment: false,
    attachGithubContextToCustomPrompt: true,
    junieWorkingDir: "/tmp/junie-work",
    appToken: "test-token",
    prompt: "",
    triggerPhrase: "@junie-agent",
    assigneeTrigger: "",
    labelTrigger: "junie",
    baseBranch: "main",
    targetBranch: undefined,
    allowedMcpServers: undefined,
};

// Default repository info
const defaultRepository = {
    id: 123456789,
    node_id: "R_kgDOABCDEF",
    name: "test-repo",
    full_name: "test-owner/test-repo",
    private: false,
    owner: {
        login: "test-owner",
        id: 12345,
        node_id: "U_kgDOABCDE",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        gravatar_id: "",
        url: "https://api.github.com/users/test-owner",
        html_url: "https://github.com/test-owner",
        followers_url: "https://api.github.com/users/test-owner/followers",
        following_url: "https://api.github.com/users/test-owner/following{/other_user}",
        gists_url: "https://api.github.com/users/test-owner/gists{/gist_id}",
        starred_url: "https://api.github.com/users/test-owner/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/test-owner/subscriptions",
        organizations_url: "https://api.github.com/users/test-owner/orgs",
        repos_url: "https://api.github.com/users/test-owner/repos",
        events_url: "https://api.github.com/users/test-owner/events{/privacy}",
        received_events_url: "https://api.github.com/users/test-owner/received_events",
        type: "User",
        site_admin: false,
    },
    html_url: "https://github.com/test-owner/test-repo",
    description: "Test repository",
    fork: false,
    url: "https://api.github.com/repos/test-owner/test-repo",
    default_branch: "main",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    pushed_at: "2024-01-15T00:00:00Z",
};

// Mock user objects
const mockUser = {
    login: "contributor-user",
    id: 67890,
    node_id: "U_kgDOABCDG",
    avatar_url: "https://avatars.githubusercontent.com/u/67890",
    gravatar_id: "",
    url: "https://api.github.com/users/contributor-user",
    html_url: "https://github.com/contributor-user",
    type: "User",
    site_admin: false,
};

const mockSender = {
    ...mockUser,
    followers_url: "https://api.github.com/users/contributor-user/followers",
    following_url: "https://api.github.com/users/contributor-user/following{/other_user}",
    gists_url: "https://api.github.com/users/contributor-user/gists{/gist_id}",
    starred_url: "https://api.github.com/users/contributor-user/starred{/owner}{/repo}",
    subscriptions_url: "https://api.github.com/users/contributor-user/subscriptions",
    organizations_url: "https://api.github.com/users/contributor-user/orgs",
    repos_url: "https://api.github.com/users/contributor-user/repos",
    events_url: "https://api.github.com/users/contributor-user/events{/privacy}",
    received_events_url: "https://api.github.com/users/contributor-user/received_events",
};

// Override interface for customizing contexts
export interface MockContextOverrides {
    eventName?: string;
    eventAction?: string;
    actor?: string;
    inputs?: Partial<typeof defaultInputs>;
    entityNumber?: number;
    isPR?: boolean;
    payload?: any;
}

export const createMockContext = (overrides: MockContextOverrides = {}): JunieExecutionContext => {
    return {
        runId: "1234567890",
        workflow: "Test Workflow",
        eventName: (overrides.eventName as any) || "issue_comment",
        eventAction: overrides.eventAction || "created",
        actor: overrides.actor || "contributor-user",
        actorEmail: `67890+${overrides.actor || "contributor-user"}@users.noreply.github.com`,
        tokenOwner: {id: 123, login: "test-bot[bot]", type: "Bot"},
        entityNumber: overrides.entityNumber ?? 55,
        isPR: overrides.isPR ?? false,
        inputs: {
            ...defaultInputs,
            ...overrides.inputs,
        },
        payload: overrides.payload || ({
            action: "created",
            repository: defaultRepository,
            sender: mockSender,
        } as any),
    };
};

// Pre-built contexts for common scenarios
export const mockIssueOpenedContext: JunieExecutionContext = createMockContext({
    eventName: "issues",
    eventAction: "opened",
    entityNumber: 42,
    isPR: false,
    payload: {
        action: "opened",
        issue: {
            number: 42,
            title: "Test issue",
            body: "@junie-agent please help with this bug",
            html_url: "https://github.com/test-owner/test-repo/issues/42",
            user: mockUser,
            state: "open",
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as IssuesEvent,
});

export const mockIssueAssignedContext: JunieExecutionContext = createMockContext({
    eventName: "issues",
    eventAction: "assigned",
    entityNumber: 42,
    isPR: false,
    payload: {
        action: "assigned",
        issue: {
            number: 42,
            title: "Test issue",
            body: "Issue body",
            html_url: "https://github.com/test-owner/test-repo/issues/42",
            user: mockUser,
            state: "open",
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        assignee: {
            ...mockUser,
            login: "junie-bot",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as any,
});

export const mockIssueLabeledContext: JunieExecutionContext = createMockContext({
    eventName: "issues",
    eventAction: "labeled",
    entityNumber: 42,
    isPR: false,
    payload: {
        action: "labeled",
        issue: {
            number: 42,
            title: "Test issue",
            body: "Issue body",
            html_url: "https://github.com/test-owner/test-repo/issues/42",
            user: mockUser,
            state: "open",
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        label: {
            name: "junie",
            color: "green",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as any,
});

export const mockIssueCommentContext: JunieExecutionContext = createMockContext({
    eventName: "issue_comment",
    eventAction: "created",
    entityNumber: 55,
    isPR: false,
    payload: {
        action: "created",
        issue: {
            number: 55,
            title: "Test issue with comment",
            body: "Issue description",
            html_url: "https://github.com/test-owner/test-repo/issues/55",
            user: mockUser,
            state: "open",
            pull_request: undefined,
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        comment: {
            id: 999,
            body: "@junie-agent can you help with this?",
            html_url: "https://github.com/test-owner/test-repo/issues/55#issuecomment-999",
            user: mockUser,
            created_at: "2024-01-15T11:00:00Z",
            updated_at: "2024-01-15T11:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as IssueCommentEvent,
});

export const mockPullRequestCommentContext: JunieExecutionContext = createMockContext({
    eventName: "issue_comment",
    eventAction: "created",
    entityNumber: 100,
    isPR: true,
    payload: {
        action: "created",
        issue: {
            number: 100,
            title: "Test PR",
            body: "PR description",
            html_url: "https://github.com/test-owner/test-repo/pull/100",
            user: mockUser,
            state: "open",
            pull_request: {
                url: "https://api.github.com/repos/test-owner/test-repo/pulls/100",
                html_url: "https://github.com/test-owner/test-repo/pull/100",
            },
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        comment: {
            id: 888,
            body: "@junie-agent review this code",
            html_url: "https://github.com/test-owner/test-repo/pull/100#issuecomment-888",
            user: mockUser,
            created_at: "2024-01-15T11:00:00Z",
            updated_at: "2024-01-15T11:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as IssueCommentEvent,
});

export const mockPullRequestOpenedContext: JunieExecutionContext = createMockContext({
    eventName: "pull_request",
    eventAction: "opened",
    entityNumber: 200,
    isPR: true,
    payload: {
        action: "opened",
        pull_request: {
            number: 200,
            title: "Add new feature",
            body: "@junie-agent please review",
            html_url: "https://github.com/test-owner/test-repo/pull/200",
            state: "open",
            user: mockUser,
            head: {
                ref: "feature-branch",
                sha: "abc123",
            },
            base: {
                ref: "main",
                sha: "def456",
            },
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as PullRequestEvent,
});

export const mockPullRequestReviewContext: JunieExecutionContext = createMockContext({
    eventName: "pull_request_review",
    eventAction: "submitted",
    entityNumber: 200,
    isPR: true,
    payload: {
        action: "submitted",
        review: {
            id: 777,
            body: "@junie-agent fix these issues",
            html_url: "https://github.com/test-owner/test-repo/pull/200#pullrequestreview-777",
            user: mockUser,
            state: "changes_requested",
            submitted_at: "2024-01-15T12:00:00Z",
        },
        pull_request: {
            number: 200,
            title: "Add new feature",
            body: "PR description",
            html_url: "https://github.com/test-owner/test-repo/pull/200",
            state: "open",
            user: mockUser,
            head: {
                ref: "feature-branch",
                sha: "abc123",
            },
            base: {
                ref: "main",
                sha: "def456",
            },
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as PullRequestReviewEvent,
});

export const mockPullRequestReviewCommentContext: JunieExecutionContext = createMockContext({
    eventName: "pull_request_review_comment",
    eventAction: "created",
    entityNumber: 200,
    isPR: true,
    payload: {
        action: "created",
        comment: {
            id: 666,
            body: "@junie-agent this looks wrong",
            html_url: "https://github.com/test-owner/test-repo/pull/200#discussion_r666",
            user: mockUser,
            path: "src/index.ts",
            position: 10,
            line: 42,
            created_at: "2024-01-15T12:00:00Z",
            updated_at: "2024-01-15T12:00:00Z",
        },
        pull_request: {
            number: 200,
            title: "Add new feature",
            body: "PR description",
            html_url: "https://github.com/test-owner/test-repo/pull/200",
            state: "open",
            user: mockUser,
            head: {
                ref: "feature-branch",
                sha: "abc123",
            },
            base: {
                ref: "main",
                sha: "def456",
            },
            created_at: "2024-01-15T10:00:00Z",
            updated_at: "2024-01-15T10:00:00Z",
        },
        repository: defaultRepository,
        sender: mockSender,
    } as PullRequestReviewCommentEvent,
});
