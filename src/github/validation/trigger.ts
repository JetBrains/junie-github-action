#!/usr/bin/env bun

import type {GitHubContext, ParsedGitHubContext} from "../context";
import {
    isIssueCommentEvent,
    isIssuesAssignedEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
} from "../context";

export function checkContainsTrigger(context: GitHubContext): boolean {
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

export function isReviewOrCommentHasTrigger(context: GitHubContext, regExp: RegExp) {
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
}

export function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
