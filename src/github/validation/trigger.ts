#!/usr/bin/env bun

import type {JunieExecutionContext} from "../context";
import {
    isIssueCommentEvent,
    isIssuesAssignedEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
} from "../context";
import {CODE_REVIEW_TRIGGER_PHRASE_REGEXP, FIX_CI_TRIGGER_PHRASE_REGEXP, MINOR_FIX_TRIGGER_PHRASE_REGEXP, RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP} from "../../constants/github";

/**
 * Detects if the Junie trigger phrase is present in the workflow context
 * Checks for @mentions, labels, or assignees that match Junie trigger patterns
 */
export function detectJunieTriggerPhrase(context: JunieExecutionContext): boolean {
    const {
        inputs: {assigneeTrigger, labelTrigger, triggerPhrase},
    } = context;
    const triggerPhraseRegex = new RegExp(`(^|\\s)${escapeRegExp(triggerPhrase)}([\\s.,!?;:]|$)`, 'i');

    if (isIssuesAssignedEvent(context)) {
        let triggerUser = assigneeTrigger.replace(/^@/, "");
        const assigneeUsername = context.payload.assignee?.login || "";

        if (triggerUser && assigneeUsername === triggerUser) {
            console.log(`Issue assigned to trigger user '${triggerUser}'`);
            return true;
        }
    }

    if (isIssuesEvent(context) && context.eventAction === "labeled") {
        const labelName = (context.payload as any).label?.name || "";

        if (labelTrigger && labelName === labelTrigger) {
            console.log(`Issue labeled with trigger label '${labelTrigger}'`);
            return true;
        }
    }

    if (isIssuesEvent(context) && context.eventAction === "opened") {
        const issueBody = context.payload.issue.body || "";
        const issueTitle = context.payload.issue.title || "";

        if (triggerPhraseRegex.test(issueBody)) {
            console.log(
                `Issue body contains exact trigger phrase '${triggerPhrase}'`,
            );
            return true;
        }

        if (triggerPhraseRegex.test(issueTitle)) {
            console.log(
                `Issue title contains exact trigger phrase '${triggerPhrase}'`,
            );
            return true;
        }
    }

    if (isPullRequestEvent(context)) {
        const prBody = context.payload.pull_request.body || "";
        const prTitle = context.payload.pull_request.title || "";

        if (triggerPhraseRegex.test(prBody)) {
            console.log(
                `Pull request body contains exact trigger phrase '${triggerPhrase}'`,
            );
            return true;
        }

        if (triggerPhraseRegex.test(prTitle)) {
            console.log(
                `Pull request title contains exact trigger phrase '${triggerPhrase}'`,
            );
            return true;
        }
    }

    const hasTrigger = isReviewOrCommentHasTrigger(context, triggerPhraseRegex)

    if (hasTrigger) {
        return true;
    }

    console.log(`No trigger was met for ${triggerPhrase}`);
    return false;
}

export function isReviewOrCommentHasResolveConflictsTrigger(context: JunieExecutionContext) {
    return isReviewOrCommentHasTrigger(context, RESOLVE_CONFLICTS_TRIGGER_PHRASE_REGEXP)
}

export function isReviewOrCommentHasCodeReviewTrigger(context: JunieExecutionContext) {
    return isReviewOrCommentHasTrigger(context, CODE_REVIEW_TRIGGER_PHRASE_REGEXP)
}

export function isReviewOrCommentHasFixCITrigger(context: JunieExecutionContext) {
    return isReviewOrCommentHasTrigger(context, FIX_CI_TRIGGER_PHRASE_REGEXP)
}

export function isReviewOrCommentHasMinorFixTrigger(context: JunieExecutionContext) {
    return isReviewOrCommentHasTrigger(context, MINOR_FIX_TRIGGER_PHRASE_REGEXP)
}

export function isReviewOrCommentHasTrigger(context: JunieExecutionContext, regExp: RegExp) {
    if (
        isPullRequestReviewEvent(context) &&
        (context.eventAction === "submitted" || context.eventAction === "edited")
    ) {
        const reviewBody = context.payload.review.body || "";

        if (regExp.test(reviewBody)) {
            console.log(
                `Pull request review contains exact trigger phrase '${regExp}'`,
            );
            return true;
        }
    }

    if (
        isIssueCommentEvent(context) ||
        isPullRequestReviewCommentEvent(context)
    ) {
        const commentBody = context.payload.comment.body;

        if (regExp.test(commentBody)) {
            console.log(`Comment contains exact trigger phrase '${regExp}'`);
            return true;
        }
    }

    return false;
}

export function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
