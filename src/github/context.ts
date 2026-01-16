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
import {CODE_REVIEW_ACTION, DEFAULT_TRIGGER_PHRASE, JIRA_EVENT_ACTION, RESOLVE_CONFLICTS_ACTION} from "../constants/github";

// Jira integration types
export type JiraComment = {
    author: string;
    body: string;
    created: string;
};

export type JiraAttachment = {
    filename: string;
    mimeType: string;
    size: number;
    content: string;  // URL to download the attachment
};

export type JiraIssuePayload = WorkflowDispatchEvent & {
    issueKey: string;
    issueSummary: string;
    issueDescription: string;
    comments: JiraComment[];
    attachments: JiraAttachment[];
    action: typeof JIRA_EVENT_ACTION;
};

// Jira integration types
export type ResolveConflictsEventPayload = WorkflowDispatchEvent & {
    action: typeof RESOLVE_CONFLICTS_ACTION;
};

export type CodeReviewEventPayload = WorkflowDispatchEvent & {
    action: typeof CODE_REVIEW_ACTION;
};

export type ScheduleEvent = {
    action?: never;
    schedule?: string;
    repository: Repository;
};

// Events triggered by user interactions (comments, issues, PRs)
const USER_TRIGGERED_EVENTS = [
    "push",
    "issues",
    "issue_comment",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
] as const;

// Events triggered by automation/schedules
const SYSTEM_TRIGGERED_EVENTS = [
    "workflow_dispatch",
    "repository_dispatch",
    "schedule",
    "workflow_run",
    "check_suite",
] as const;

type UserTriggeredEventName = (typeof USER_TRIGGERED_EVENTS)[number];
type SystemTriggeredEventName = (typeof SYSTEM_TRIGGERED_EVENTS)[number];

// Base workflow context shared by all Junie executions
type JunieWorkflowContext = {
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
        attachGithubContextToCustomPrompt: boolean;
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

// Context for user-initiated events that we track
export type UserInitiatedEventContext = JunieWorkflowContext & {
    eventName: UserTriggeredEventName;
    payload:
        | PushEvent
        | IssuesEvent
        | IssueCommentEvent
        | PullRequestEvent
        | PullRequestReviewEvent
        | PullRequestReviewCommentEvent;
};

// Context for automated workflow events (workflow_dispatch, schedule, etc.)
export type AutomationEventContext = JunieWorkflowContext & {
    eventName: SystemTriggeredEventName;
    payload:
        | CheckSuiteEvent
        | WorkflowDispatchEvent
        | RepositoryDispatchEvent
        | ScheduleEvent
        | WorkflowRunEvent
        | JiraIssuePayload
        | ResolveConflictsEventPayload
        | CodeReviewEventPayload;
};

// Union type representing all possible Junie execution contexts
export type JunieExecutionContext = UserInitiatedEventContext | AutomationEventContext;

/**
 * Extracts and builds Junie workflow context from GitHub event data
 * @param tokenOwner - Information about the token owner (user or app)
 * @returns Junie execution context with event-specific data
 */
export function extractJunieWorkflowContext(tokenOwner: TokenOwner): JunieExecutionContext {
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
            attachGithubContextToCustomPrompt: process.env.ATTACH_GITHUB_CONTEXT_TO_CUSTOM_PROMPT !== "false",
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

    let parsedContext: JunieExecutionContext;
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

            if (payload.inputs?.action == RESOLVE_CONFLICTS_ACTION) {
                parsedContext = {
                    ...commonFields,
                    isPR: true,
                    entityNumber: payload.inputs?.prNumber as number,
                    eventName: context.eventName,
                    payload: {
                        ...payload,
                        action: RESOLVE_CONFLICTS_ACTION
                    },
                };
                break
            }

            if (payload.inputs?.action == CODE_REVIEW_ACTION) {
                parsedContext = {
                    ...commonFields,
                    isPR: true,
                    entityNumber: payload.inputs?.prNumber ? Number(payload.inputs.prNumber) : undefined,
                    eventName: context.eventName,
                    payload: {
                        ...payload,
                        action: CODE_REVIEW_ACTION
                    },
                };
                break;
            }

            // Handle Jira integration event
            if (payload.inputs?.action == JIRA_EVENT_ACTION) {
                parsedContext = extractJiraEventData(payload, commonFields)
                break;
            }

            parsedContext = {
                ...commonFields,
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

function extractJiraEventData(workflowPayload: WorkflowDispatchEvent, context: JunieWorkflowContext): JunieExecutionContext {
    const issueKey = workflowPayload.inputs?.issue_key as string;
    const issueSummary = workflowPayload.inputs?.issue_summary as string;
    const issueDescription = workflowPayload.inputs?.issue_description as string;

    if (!issueKey || !issueSummary) {
        throw new Error(`Missing Jira issue data in workflow payload: ${JSON.stringify(workflowPayload)}`);
    }

    // Parse comments and attachments JSON arrays (default to empty arrays)
    const comments = workflowPayload.inputs?.issue_comments
        ? JSON.parse(workflowPayload.inputs.issue_comments as string)
        : [];

    const attachments = workflowPayload.inputs?.issue_attachments
        ? JSON.parse(workflowPayload.inputs.issue_attachments as string)
        : [];

    if (comments.length > 0) {
        console.log(`✓ Parsed ${comments.length} comment(s) from Jira issue`);
    }

    if (attachments.length > 0) {
        console.log(`✓ Parsed ${attachments.length} attachment(s) from Jira issue`);
    }

    console.log(`✓ Jira issue detected: ${issueKey} - ${issueSummary}`);

    // Return Jira-specific context with JiraWorkflowDispatchEvent payload
    return {
        ...context,
        eventName: "workflow_dispatch",
        payload: {
            ...workflowPayload,
            issueKey,
            issueSummary,
            issueDescription: issueDescription || '',
            comments,
            attachments,
            action: JIRA_EVENT_ACTION,
        },
    };
}

export function isJiraWorkflowDispatchEvent(context: JunieExecutionContext): context is AutomationEventContext & { payload: JiraIssuePayload } {
    return context.eventName === "workflow_dispatch" && 'action' in context.payload && context.payload.action === JIRA_EVENT_ACTION;
}

export function isResolveConflictsWorkflowDispatchEvent(context: JunieExecutionContext): context is AutomationEventContext & { payload: ResolveConflictsEventPayload }  {
    return context.eventName === "workflow_dispatch" && 'action' in context.payload && context.payload.action === RESOLVE_CONFLICTS_ACTION;
}

export function isCodeReviewWorkflowDispatchEvent(context: JunieExecutionContext): context is AutomationEventContext & { payload: CodeReviewEventPayload }  {
    return context.eventName === "workflow_dispatch" && 'action' in context.payload && context.payload.action === CODE_REVIEW_ACTION;
}

export function isCheckSuiteEvent(context: JunieExecutionContext): context is AutomationEventContext & {
    payload: CheckSuiteEvent
} {
    return context.eventName === "check_suite";
}

export function isPushEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: PushEvent } {
    return context.eventName === "push";
}

export function isIssuesEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: IssuesEvent } {
    return context.eventName === "issues";
}

export function isIssueCommentEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: IssueCommentEvent } {
    return context.eventName === "issue_comment";
}

export function isPullRequestEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: PullRequestEvent } {
    return context.eventName === "pull_request";
}

export function isPullRequestReviewEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: PullRequestReviewEvent } {
    return context.eventName === "pull_request_review";
}

export function isPullRequestReviewCommentEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: PullRequestReviewCommentEvent } {
    return context.eventName === "pull_request_review_comment";
}

export function isIssuesAssignedEvent(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext & { payload: IssuesAssignedEvent } {
    return isIssuesEvent(context) && context.eventAction === "assigned";
}

/**
 * Checks if the context is triggered by user interaction (comments, PR/issue events)
 */
export function isTriggeredByUserInteraction(
    context: JunieExecutionContext,
): context is UserInitiatedEventContext {
    return USER_TRIGGERED_EVENTS.includes(context.eventName as UserTriggeredEventName);
}

function getActorEmail(): string {
    const actor = github.context.actor;
    const userId = github.context.payload.sender?.id;
    return `${userId}+${actor}@users.noreply.github.com`;
}
