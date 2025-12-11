import * as github from "@actions/github";
import * as core from "@actions/core";
import {
    CheckSuiteEvent,
    IssueCommentEvent,
    IssuesAssignedEvent,
    IssuesEvent,
    PullRequestEvent,
    PullRequestReviewCommentEvent,
    PullRequestReviewEvent,
    PushEvent,
    Repository,
    RepositoryDispatchEvent,
    WorkflowDispatchEvent,
    WorkflowRunEvent,
} from "@octokit/webhooks-types";
import type {TokenOwner} from "./operations/auth";
import {OUTPUT_VARS} from "../constants/environment";
import {DEFAULT_TRIGGER_PHRASE, RESOLVE_CONFLICTS_ACTION} from "../constants/github";


export type ScheduleEvent = {
    action?: never;
    schedule?: string;
    repository: Repository;
};

const ENTITY_EVENT_NAMES = [
    "push",
    "issues",
    "issue_comment",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
] as const;

const AUTOMATION_EVENT_NAMES = [
    "workflow_dispatch",
    "repository_dispatch",
    "schedule",
    "workflow_run",
    "check_suite",
] as const;

type EntityEventName = (typeof ENTITY_EVENT_NAMES)[number];
type AutomationEventName = (typeof AUTOMATION_EVENT_NAMES)[number];

type BaseContext = {
    runId: string;
    workflow: string;
    eventAction?: string;
    actor: string;
    actorEmail: string;
    tokenOwner: TokenOwner;
    entityNumber?: number;
    isPR?: boolean;
    inputs: {
        resolveConflicts: boolean;
        createNewBranchForPR: boolean;
        silentMode: boolean;
        useSingleComment: boolean;
        useStructuredPrompt: boolean;
        junieWorkingDir: string;
        appToken: string;
        baseBranch?: string;
        targetBranch?: string;
        prompt: string;
        triggerPhrase: string;
        assigneeTrigger: string;
        labelTrigger: string;
        workingBranch?: string;
        allowedMcpServers?: string;
    };
};

export type AutomationEntityGitHubContext = BaseContext & {
    eventName: EntityEventName;
    payload:
        | IssuesEvent
        | IssueCommentEvent
        | PullRequestEvent
        | PullRequestReviewEvent
        | PullRequestReviewCommentEvent;
    isPR: boolean;
};

export type ParsedGitHubContext = BaseContext & {
    eventName: EntityEventName;
    payload:
        | PushEvent
        | IssuesEvent
        | IssueCommentEvent
        | PullRequestEvent
        | PullRequestReviewEvent
        | PullRequestReviewCommentEvent;
};

export type AutomationContext = BaseContext & {
    eventName: AutomationEventName;
    payload:
        | CheckSuiteEvent
        | WorkflowDispatchEvent
        | RepositoryDispatchEvent
        | ScheduleEvent
        | WorkflowRunEvent;
};

export type GitHubContext = ParsedGitHubContext | AutomationContext;

export function parseGitHubContext(tokenOwner: TokenOwner): GitHubContext {
    const context = github.context;
    const commonFields = {
        runId: process.env.GITHUB_RUN_ID!,
        workflow: process.env.GITHUB_WORKFLOW || "Junie",
        eventAction: context.payload.action,
        actor: context.actor,
        actorEmail: getActorEmail(),
        tokenOwner,
        inputs: {
            resolveConflicts: process.env.RESOLVE_CONFLICTS == "true",
            createNewBranchForPR: process.env.CREATE_NEW_BRANCH_FOR_PR == "true",
            silentMode: process.env.SILENT_MODE == "true",
            useSingleComment: process.env.USE_SINGLE_COMMENT == "true",
            useStructuredPrompt: process.env.USE_STRUCTURED_PROMPT == "true",
            junieWorkingDir: process.env.JUNIE_WORKING_DIR!,
            headRef: process.env.GITHUB_HEAD_REF,
            appToken: process.env.APP_TOKEN!,
            prompt: process.env.PROMPT || "",
            triggerPhrase: process.env.TRIGGER_PHRASE ?? DEFAULT_TRIGGER_PHRASE,
            assigneeTrigger: process.env.ASSIGNEE_TRIGGER ?? "",
            labelTrigger: process.env.LABEL_TRIGGER ?? "",
            baseBranch: process.env.BASE_BRANCH,
            targetBranch: process.env.TARGET_BRANCH,
            allowedMcpServers: process.env.ALLOWED_MCP_SERVERS,
        },
    };

    let parsedContext: GitHubContext;
    switch (context.eventName) {
        case "issues": {
            const payload = context.payload as IssuesEvent;
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload,
                entityNumber: payload.issue.number,
                isPR: false,
            };
            break;
        }
        case "issue_comment": {
            const payload = context.payload as IssueCommentEvent;
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload,
                entityNumber: payload.issue.number,
                isPR: Boolean(payload.issue.pull_request),
            };
            break;
        }
        case "pull_request":
        case "pull_request_target": {
            const payload = context.payload as PullRequestEvent;
            parsedContext = {
                ...commonFields,
                eventName: "pull_request",
                payload,
                entityNumber: payload.pull_request.number,
                isPR: true,
            };
            break;
        }
        case "pull_request_review": {
            const payload = context.payload as PullRequestReviewEvent;
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload,
                entityNumber: payload.pull_request.number,
                isPR: true,
            };
            break;
        }
        case "pull_request_review_comment": {
            const payload = context.payload as PullRequestReviewCommentEvent;
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload,
                entityNumber: payload.pull_request.number,
                isPR: true,
            };
            break
        }
        case "check_suite": {
            const payload = context.payload as CheckSuiteEvent;
            const isPr = payload.check_suite.pull_requests.length > 0
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload: payload,
                entityNumber: isPr ? payload.check_suite.pull_requests[0].number : undefined,
                isPR: isPr,
            };
            break
        }
        case "push": {
            const payload = context.payload as PushEvent;
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload: payload
            };
            break
        }
        case "workflow_dispatch": {
            const payload = context.payload as WorkflowDispatchEvent;
            let prNumber = undefined
            let isPR = false
            if (payload.inputs?.action == RESOLVE_CONFLICTS_ACTION) {
                prNumber = payload.inputs?.prNumber as number
                isPR = true
            }

            parsedContext = {
                ...commonFields,
                isPR,
                entityNumber: prNumber,
                eventName: context.eventName,
                payload: context.payload as unknown as WorkflowDispatchEvent,
            };
            break;
        }
        case "repository_dispatch": {
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload: context.payload as unknown as RepositoryDispatchEvent,
            };
            break;
        }
        case "schedule": {
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload: context.payload as unknown as ScheduleEvent,
            };
            break
        }
        case "workflow_run": {
            const payload = context.payload as WorkflowRunEvent;
            const isPR = payload.workflow_run.pull_requests.length > 0
            parsedContext = {
                ...commonFields,
                eventName: context.eventName,
                payload,
                isPR,
                entityNumber: isPR ? payload.workflow_run.pull_requests[0].number : undefined,
            };
            break;
        }
        default:
            throw new Error(`Unsupported event type: ${context.eventName}`);
    }
    core.setOutput(OUTPUT_VARS.ACTOR_NAME, parsedContext.actor);
    core.setOutput(OUTPUT_VARS.ACTOR_EMAIL, parsedContext.actorEmail);
    core.setOutput(OUTPUT_VARS.PARSED_CONTEXT, JSON.stringify(parsedContext));
    return parsedContext;
}

export function isWorkflowDispatchEvent(context: GitHubContext): context is AutomationContext & { payload: WorkflowDispatchEvent } {
    return context.eventName === "workflow_dispatch";
}

export function isCheckSuiteEvent(context: GitHubContext): context is AutomationContext & { payload: CheckSuiteEvent } {
    return context.eventName === "check_suite";
}

export function isPushEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: PushEvent } {
    return context.eventName === "push";
}

export function isIssuesEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssuesEvent } {
    return context.eventName === "issues";
}

export function isIssueCommentEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssueCommentEvent } {
    return context.eventName === "issue_comment";
}

export function isPullRequestEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestEvent } {
    return context.eventName === "pull_request";
}

export function isPullRequestReviewEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewEvent } {
    return context.eventName === "pull_request_review";
}

export function isPullRequestReviewCommentEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewCommentEvent } {
    return context.eventName === "pull_request_review_comment";
}

export function isIssuesAssignedEvent(
    context: GitHubContext,
): context is ParsedGitHubContext & { payload: IssuesAssignedEvent } {
    return isIssuesEvent(context) && context.eventAction === "assigned";
}

export function isEntityContext(
    context: GitHubContext,
): context is ParsedGitHubContext {
    return ENTITY_EVENT_NAMES.includes(context.eventName as EntityEventName);
}


export function isAutomationContext(
    context: GitHubContext,
): context is AutomationContext {
    return AUTOMATION_EVENT_NAMES.includes(
        context.eventName as AutomationEventName,
    );
}

function getActorEmail(): string {
    const actor = github.context.actor;
    const userId = github.context.payload.sender?.id;
    return `${userId}+${actor}@users.noreply.github.com`;
}
