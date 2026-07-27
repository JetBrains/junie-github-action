import type {Octokit} from '@octokit/rest';
import {
    extractFeedbackTokenFromBody,
    parseFeedbackMarker,
    parseInlineFeedbackRunId,
} from '../../../../utils/code-review-feedback-markers';
import type {
    CollectedComment,
    CollectedReaction,
    SessionFeedbackSignals,
} from './types';

type ListReactionsFn = (commentId: number, kind: 'issue' | 'review') => Promise<CollectedReaction[]>;

async function listIssueCommentReactions(
    octokit: Octokit,
    owner: string,
    repo: string,
    commentId: number,
): Promise<CollectedReaction[]> {
    const { data } = await octokit.rest.reactions.listForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        per_page: 100,
    });
    return data.map((r) => ({
        content: r.content,
        userLogin: r.user?.login || 'unknown',
        userType: r.user?.type,
    }));
}

async function listReviewCommentReactions(
    octokit: Octokit,
    owner: string,
    repo: string,
    commentId: number,
): Promise<CollectedReaction[]> {
    const { data } = await octokit.rest.reactions.listForPullRequestReviewComment({
        owner,
        repo,
        comment_id: commentId,
        per_page: 100,
    });
    return data.map((r) => ({
        content: r.content,
        userLogin: r.user?.login || 'unknown',
        userType: r.user?.type,
    }));
}

async function paginateIssueComments(
    octokit: Octokit,
    owner: string,
    repo: string,
    issueNumber: number,
) {
    return octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
    });
}

async function paginateReviewComments(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number,
) {
    return octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
    });
}

/**
 * Discover Junie feedback sessions on a PR and gather reactions/replies.
 * Sessions come from summary markers / feedback URLs; inline comments are linked by run id.
 */
export async function collectSessionFeedbackSignals(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<SessionFeedbackSignals[]> {
    const issueComments = await paginateIssueComments(octokit, owner, repo, prNumber);
    const reviewComments = await paginateReviewComments(octokit, owner, repo, prNumber);

    const sessionsByKey = new Map<string, SessionFeedbackSignals>();

    for (const comment of issueComments) {
        const marker = parseFeedbackMarker(comment.body || '');
        const token = extractFeedbackTokenFromBody(comment.body || '');
        if (!marker && !token) {
            continue;
        }

        const sessionId = marker?.sessionId || `token-${token!.slice(0, 16)}`;
        const runId = marker?.runId || 'unknown';
        const key = `${sessionId}::${runId}`;

        const existing = sessionsByKey.get(key) || {
            sessionId,
            runId,
            token,
            summaryCommentId: comment.id,
            comments: [] as CollectedComment[],
        };

        existing.token = existing.token || token;
        existing.summaryCommentId = comment.id;

        const reactions = await listIssueCommentReactions(octokit, owner, repo, comment.id);
        existing.comments.push({
            id: comment.id,
            kind: 'summary',
            body: comment.body || '',
            userLogin: comment.user?.login || 'unknown',
            htmlUrl: comment.html_url,
            reactions,
        });

        sessionsByKey.set(key, existing);
    }

    // Fallback: junie-bot summary without new marker but with Share feedback URL already handled above.
    // Attach inline comments + thread replies by run id.
    for (const session of sessionsByKey.values()) {
        if (session.runId === 'unknown') {
            continue;
        }

        const inlineForRun = reviewComments.filter(
            (c) => parseInlineFeedbackRunId(c.body || '') === session.runId,
        );

        for (const inline of inlineForRun) {
            const reactions = await listReviewCommentReactions(octokit, owner, repo, inline.id);
            session.comments.push({
                id: inline.id,
                kind: 'inline',
                body: inline.body || '',
                userLogin: inline.user?.login || 'unknown',
                htmlUrl: inline.html_url,
                path: inline.path,
                reactions,
            });

            // Thread replies: review comments with in_reply_to pointing at this inline comment
            const replies = reviewComments.filter((c) => c.in_reply_to_id === inline.id);
            for (const reply of replies) {
                session.comments.push({
                    id: reply.id,
                    kind: 'reply',
                    body: reply.body || '',
                    userLogin: reply.user?.login || 'unknown',
                    htmlUrl: reply.html_url,
                    path: reply.path,
                    reactions: [],
                });
            }
        }

        // Issue-comment replies that quote/mention the summary are hard to detect reliably;
        // include non-Junie issue comments after the summary as weak replies only if they
        // reference "junie" / "review" lightly — skip for MVP to avoid noise.
    }

    return Array.from(sessionsByKey.values());
}

/** Test helper: build reactions fetcher overrides without hitting GitHub. */
export async function collectSessionFeedbackSignalsWithFetchers(
    issueComments: Array<{ id: number; body: string; userLogin: string; htmlUrl?: string }>,
    reviewComments: Array<{
        id: number;
        body: string;
        userLogin: string;
        htmlUrl?: string;
        path?: string;
        inReplyToId?: number;
    }>,
    listReactions: ListReactionsFn,
): Promise<SessionFeedbackSignals[]> {
    const sessionsByKey = new Map<string, SessionFeedbackSignals>();

    for (const comment of issueComments) {
        const marker = parseFeedbackMarker(comment.body);
        const token = extractFeedbackTokenFromBody(comment.body);
        if (!marker && !token) {
            continue;
        }
        const sessionId = marker?.sessionId || `token-${token!.slice(0, 16)}`;
        const runId = marker?.runId || 'unknown';
        const key = `${sessionId}::${runId}`;
        const existing = sessionsByKey.get(key) || {
            sessionId,
            runId,
            token,
            summaryCommentId: comment.id,
            comments: [] as CollectedComment[],
        };
        existing.token = existing.token || token;
        existing.summaryCommentId = comment.id;
        existing.comments.push({
            id: comment.id,
            kind: 'summary',
            body: comment.body,
            userLogin: comment.userLogin,
            htmlUrl: comment.htmlUrl,
            reactions: await listReactions(comment.id, 'issue'),
        });
        sessionsByKey.set(key, existing);
    }

    for (const session of sessionsByKey.values()) {
        if (session.runId === 'unknown') continue;
        const inlineForRun = reviewComments.filter(
            (c) => parseInlineFeedbackRunId(c.body) === session.runId,
        );
        for (const inline of inlineForRun) {
            session.comments.push({
                id: inline.id,
                kind: 'inline',
                body: inline.body,
                userLogin: inline.userLogin,
                htmlUrl: inline.htmlUrl,
                path: inline.path,
                reactions: await listReactions(inline.id, 'review'),
            });
            for (const reply of reviewComments.filter((c) => c.inReplyToId === inline.id)) {
                session.comments.push({
                    id: reply.id,
                    kind: 'reply',
                    body: reply.body,
                    userLogin: reply.userLogin,
                    htmlUrl: reply.htmlUrl,
                    path: reply.path,
                    reactions: [],
                });
            }
        }
    }

    return Array.from(sessionsByKey.values());
}
