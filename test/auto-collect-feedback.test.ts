import { describe, expect, test } from 'bun:test';
import {
    createCodeReviewFeedbackMarker,
    createInlineFeedbackMarker,
} from '../src/constants/github';
import {
    extractFeedbackTokenFromBody,
    parseFeedbackMarker,
    parseFeedbackTokenClaims,
    parseInlineFeedbackRunId,
} from '../src/utils/code-review-feedback-markers';
import {
    buildAutoCollectedComment,
    evaluateCollectorVerdict,
} from '../src/github/operations/feedback/auto-collect/mapping';
import { parseAgentFeedbackJson } from '../src/github/operations/feedback/auto-collect/agent';
import { collectSessionFeedbackSignalsWithFetchers } from '../src/github/operations/feedback/auto-collect/collector';
import { buildAutoCollectNotificationBody } from '../src/github/operations/feedback/auto-collect/notify';
import type { SessionFeedbackSignals } from '../src/github/operations/feedback/auto-collect/types';

describe('feedback markers', () => {
    test('parses summary marker and token from body', () => {
        const body = `${createCodeReviewFeedbackMarker('session-1', 42, 'abc.def')}
---
**Help us improve Junie code review (EAP):** [Share feedback](https://junie.jetbrains.com/code-review-feedback?token=abc.def)`;

        expect(parseFeedbackMarker(body)).toEqual({
            sessionId: 'session-1',
            runId: '42',
            token: 'abc.def',
        });
        expect(extractFeedbackTokenFromBody(body)).toBe('abc.def');
    });

    test('parses inline marker', () => {
        const body = `Looks good\n\n${createInlineFeedbackMarker(99)}`;
        expect(parseInlineFeedbackRunId(body)).toBe('99');
    });

    test('recovers sid/rid from feedback token JWT payload', () => {
        const payload = Buffer.from(JSON.stringify({
            sid: 'session-260727-151332-1bxm',
            repo: 'JetBrains/junie-agent',
            pr: 7435,
            rid: 30278879175,
            exp: 1785770192,
        })).toString('base64url');
        const token = `${payload}.sig`;

        expect(parseFeedbackTokenClaims(token)).toEqual({
            sessionId: 'session-260727-151332-1bxm',
            runId: '30278879175',
            repository: 'JetBrains/junie-agent',
            prNumber: 7435,
        });
    });

    test('collects inline reactions when only Share feedback URL is present (no HTML marker)', async () => {
        const payload = Buffer.from(JSON.stringify({
            sid: 'session-from-token',
            rid: 777,
        })).toString('base64url');
        const token = `${payload}.sig`;

        const sessions = await collectSessionFeedbackSignalsWithFetchers(
            [{
                id: 10,
                body: `[Share feedback](https://x/code-review-feedback?token=${token})`,
                userLogin: 'junie-agent',
            }],
            [
                {
                    id: 20,
                    body: `issue here\n${createInlineFeedbackMarker(777)}`,
                    userLogin: 'junie-agent',
                    path: 'a.ts',
                },
                {
                    id: 21,
                    body: 'I disagree with this',
                    userLogin: 'alice',
                    inReplyToId: 20,
                },
            ],
            async (commentId, kind) => {
                if (kind === 'review' && commentId === 20) {
                    return [{ content: '+1', userLogin: 'alice', userType: 'User' }];
                }
                return [];
            },
        );

        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('session-from-token');
        expect(sessions[0].runId).toBe('777');
        expect(sessions[0].comments.map((c) => c.kind)).toEqual(['summary', 'inline', 'reply']);
        expect(sessions[0].comments[1].reactions).toEqual([
            { content: '+1', userLogin: 'alice', userType: 'User' },
        ]);
    });
});

describe('evaluateCollectorVerdict', () => {
    function signals(partial: Partial<SessionFeedbackSignals> & Pick<SessionFeedbackSignals, 'comments'>): SessionFeedbackSignals {
        return {
            sessionId: 's1',
            runId: '1',
            token: 't.ok',
            ...partial,
        };
    }

    test('obvious positive from thumbs up', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'junie-agent',
                reactions: [
                    { content: '+1', userLogin: 'alice', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('obvious_positive');
        expect(verdict.rating).toBe(4);
        expect(verdict.needsAgent).toBe(false);
    });

    test('two thumbs up => rating 5', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'bot',
                reactions: [
                    { content: '+1', userLogin: 'alice', userType: 'User' },
                    { content: '+1', userLogin: 'bob', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.rating).toBe(5);
    });

    test('ignores bot reactions', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'bot',
                reactions: [
                    { content: '+1', userLogin: 'github-actions[bot]', userType: 'Bot' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('empty');
    });

    test('obvious negative', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'inline',
                body: 'x',
                userLogin: 'junie',
                reactions: [
                    { content: '-1', userLogin: 'alice', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('obvious_negative');
        expect(verdict.rating).toBe(2);
    });

    test('ambiguous when both thumbs', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'bot',
                reactions: [
                    { content: '+1', userLogin: 'alice', userType: 'User' },
                    { content: '-1', userLogin: 'bob', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('ambiguous');
        expect(verdict.needsAgent).toBe(true);
    });

    test('text_only when replies without reactions', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [
                {
                    id: 1,
                    kind: 'summary',
                    body: 'review',
                    userLogin: 'junie',
                    reactions: [],
                },
                {
                    id: 2,
                    kind: 'reply',
                    body: 'This review missed the null check',
                    userLogin: 'alice',
                    reactions: [],
                },
            ],
        }));
        expect(verdict.kind).toBe('text_only');
        expect(verdict.needsAgent).toBe(true);
        expect(verdict.replyTexts[0]).toContain('null check');
    });
});

describe('buildAutoCollectedComment', () => {
    test('includes evidence prefix', () => {
        const comment = buildAutoCollectedComment({
            kind: 'obvious_positive',
            rating: 4,
            thumbsUp: 1,
            thumbsDown: 0,
            replyTexts: ['nice catch'],
            needsAgent: false,
        });
        expect(comment).toContain('[auto-collected from PR reactions/replies]');
        expect(comment).toContain('👍×1');
        expect(comment).toContain('nice catch');
    });
});

describe('parseAgentFeedbackJson', () => {
    test('parses json embedded in text', () => {
        const result = parseAgentFeedbackJson('Here you go:\n{"rating":3,"comment":"mixed","confidence":"medium","rationale":"both sides"}\n');
        expect(result).toEqual({
            rating: 3,
            comment: 'mixed',
            confidence: 'medium',
            rationale: 'both sides',
        });
    });

    test('rejects invalid rating', () => {
        expect(parseAgentFeedbackJson('{"rating":9,"comment":"x","confidence":"high"}')).toBeUndefined();
    });
});

describe('collectSessionFeedbackSignalsWithFetchers', () => {
    test('groups inline comments by run id', async () => {
        const sessions = await collectSessionFeedbackSignalsWithFetchers(
            [{
                id: 10,
                body: `${createCodeReviewFeedbackMarker('sess-a', 777)}\n[Share feedback](https://x/code-review-feedback?token=tok.en)`,
                userLogin: 'junie-agent',
            }],
            [
                {
                    id: 20,
                    body: `issue here\n${createInlineFeedbackMarker(777)}`,
                    userLogin: 'junie-agent',
                    path: 'a.ts',
                },
                {
                    id: 21,
                    body: 'I disagree with this',
                    userLogin: 'alice',
                    inReplyToId: 20,
                },
            ],
            async (commentId, kind) => {
                if (kind === 'issue' && commentId === 10) {
                    return [{ content: '+1', userLogin: 'alice', userType: 'User' }];
                }
                return [];
            },
        );

        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('sess-a');
        expect(sessions[0].token).toBe('tok.en');
        expect(sessions[0].comments.map((c) => c.kind)).toEqual(['summary', 'inline', 'reply']);
    });
});

describe('buildAutoCollectNotificationBody', () => {
    test('renders outcomes', () => {
        const body = buildAutoCollectNotificationBody([
            { sessionId: 's1', runId: '1', status: 'submitted', rating: 4 },
            { sessionId: 's2', runId: '2', status: 'skipped_empty' },
        ]);
        expect(body).toContain('rating **4**');
        expect(body).toContain('no reactions/replies');
    });
});
