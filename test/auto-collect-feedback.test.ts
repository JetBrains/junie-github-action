import { describe, expect, mock, test } from 'bun:test';
import {
    CODE_REVIEW_FEEDBACK_SECTION_WITH_MARKER,
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
import {
    collectSessionFeedbackSignalsWithFetchers,
    resolveSessionIdentity,
    tokenDerivedSessionId,
} from '../src/github/operations/feedback/auto-collect/collector';
import {
    AUTO_COLLECT_NOTIFY_MARKER,
    buildAutoCollectNotificationBody,
} from '../src/github/operations/feedback/auto-collect/notify';
import { processSession } from '../src/github/operations/feedback/auto-collect/orchestrator';
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

    test('default review footer includes marker + Share link', () => {
        const link = 'https://junie.jetbrains.com/code-review-feedback?token=tok.en';
        const section = CODE_REVIEW_FEEDBACK_SECTION_WITH_MARKER(link, 'sess-default', 12345);
        expect(parseFeedbackMarker(section)).toEqual({
            sessionId: 'sess-default',
            runId: '12345',
            token: 'tok.en',
        });
        expect(section).toContain('Share feedback');
        expect(section).toContain(link);
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

    test('uses token suffix for sessionId fallback when sid claim is missing', () => {
        const payload = Buffer.from(
            JSON.stringify({
                rid: 123,
                exp: 1785770192,
            }),
        ).toString('base64url');
        const token = `prefix.${payload}.very-long-signature-ending-in-unique-chars`;

        const identity = resolveSessionIdentity(
            `[Share feedback](https://x/code-review-feedback?token=${token})`,
        );
        // SHA-256 hash slice
        expect(identity?.sessionId).toBe('token-1fb6d43fe72ee76b');
    });

    test('collects reactions for replies', async () => {
        const payload = Buffer.from(JSON.stringify({ sid: 's1', rid: 'r1' })).toString(
            'base64url',
        );
        const token = `${payload}.sig`;

        const sessions = await collectSessionFeedbackSignalsWithFetchers(
            [
                {
                    id: 1,
                    body: `<!-- junie-feedback:session=s1;run=r1;token=${token} -->`,
                    userLogin: 'junie',
                },
            ],
            [
                {
                    id: 2,
                    body: `inline\n${createInlineFeedbackMarker('r1')}`,
                    userLogin: 'junie',
                    path: 'f.ts',
                },
                { id: 3, body: 'reply', userLogin: 'alice', inReplyToId: 2 },
            ],
            async (id) => {
                if (id === 3) return [{ content: '+1', userLogin: 'bob', userType: 'User' }];
                return [];
            },
        );

        expect(sessions[0].comments.find((c) => c.id === 3)?.reactions).toHaveLength(1);
        expect(sessions[0].comments.find((c) => c.id === 3)?.reactions[0].userLogin).toBe(
            'bob',
        );
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

    test('heart counts as positive', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'junie',
                reactions: [
                    { content: 'heart', userLogin: 'alice', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('obvious_positive');
        expect(verdict.rating).toBe(4);
        expect(verdict.thumbsUp).toBe(1);
    });

    test('confused counts as negative', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'inline',
                body: 'x',
                userLogin: 'junie',
                reactions: [
                    { content: 'confused', userLogin: 'alice', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('obvious_negative');
        expect(verdict.rating).toBe(2);
        expect(verdict.thumbsDown).toBe(1);
    });

    test('heart and thumbs-up together can reach rating 5', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'junie',
                reactions: [
                    { content: '+1', userLogin: 'alice', userType: 'User' },
                    { content: 'heart', userLogin: 'bob', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.kind).toBe('obvious_positive');
        expect(verdict.rating).toBe(5);
    });

    test('counts all reactions even from same user', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [{
                id: 1,
                kind: 'summary',
                body: 'x',
                userLogin: 'junie',
                reactions: [
                    { content: '+1', userLogin: 'alice', userType: 'User' },
                    { content: 'heart', userLogin: 'alice', userType: 'User' },
                ],
            }],
        }));
        expect(verdict.thumbsUp).toBe(2);
        expect(verdict.rating).toBe(5);
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
                    userType: 'User',
                    reactions: [],
                },
            ],
        }));
        expect(verdict.kind).toBe('text_only');
        expect(verdict.needsAgent).toBe(true);
        expect(verdict.replyTexts[0]).toContain('null check');
    });

    test('ignores bot replies when collecting text signals', () => {
        const verdict = evaluateCollectorVerdict(signals({
            comments: [
                {
                    id: 1,
                    kind: 'summary',
                    body: 'review',
                    userLogin: 'junie-agent',
                    userType: 'Bot',
                    reactions: [],
                },
                {
                    id: 2,
                    kind: 'reply',
                    body: 'automated follow-up',
                    userLogin: 'github-actions[bot]',
                    userType: 'Bot',
                    reactions: [],
                },
            ],
        }));
        expect(verdict.kind).toBe('empty');
        expect(verdict.replyTexts).toEqual([]);
    });
});

describe('buildAutoCollectedComment', () => {
    test('includes evidence prefix and short reply summary', () => {
        const comment = buildAutoCollectedComment({
            kind: 'obvious_positive',
            rating: 4,
            thumbsUp: 1,
            thumbsDown: 0,
            replyTexts: ['nice catch'],
            needsAgent: false,
        });
        expect(comment).toContain('[auto-collected from PR reactions/replies]');
        expect(comment).toContain('👍❤️×1');
        expect(comment).toContain('nice catch');
    });

    test('does not dump full long replies into submitted comment', () => {
        const longReply = 'x'.repeat(2000);
        const comment = buildAutoCollectedComment({
            kind: 'obvious_negative',
            rating: 2,
            thumbsUp: 0,
            thumbsDown: 1,
            replyTexts: [longReply, longReply, longReply, longReply],
            needsAgent: false,
        });
        expect(comment.length).toBeLessThanOrEqual(800);
        expect(comment).toContain('…');
        expect(comment).toContain('(+1 more)');
        expect(comment).not.toContain(longReply);
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

    test('handles multiple objects by picking the one with rating (best effort)', () => {
        const text = 'Prefix {"foo":"bar"} Result: {"rating":4,"comment":"ok","confidence":"high"}';
        // New implementation iterates over objects, so it should find the one with the rating
        expect(parseAgentFeedbackJson(text)).toEqual({
            rating: 4,
            comment: 'ok',
            confidence: 'high',
            rationale: undefined,
        });
    });

    test('parses agent JSON with nested braces', () => {
        const text = 'Here is the result: {"rating": 5, "comment": "Good job!", "confidence": "high", "metadata": {"foo": "bar"}} and some extra text.';
        const result = parseAgentFeedbackJson(text);
        expect(result).toEqual({
            rating: 5,
            comment: 'Good job!',
            confidence: 'high',
            rationale: undefined,
        });
    });

    test('parses agent JSON when string values contain braces', () => {
        const text = 'Result: {"rating": 4, "comment": "Fixed {foo} and } brace", "confidence": "high", "rationale": "looks good {123}"}';
        const result = parseAgentFeedbackJson(text);
        expect(result).toEqual({
            rating: 4,
            comment: 'Fixed {foo} and } brace',
            confidence: 'high',
            rationale: 'looks good {123}',
        });
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
    test('renders outcomes with marker', () => {
        const body = buildAutoCollectNotificationBody([
            { sessionId: 's1', runId: '1', status: 'submitted', rating: 4 },
            { sessionId: 's2', runId: '2', status: 'skipped_empty' },
        ]);
        expect(body.startsWith(AUTO_COLLECT_NOTIFY_MARKER)).toBe(true);
        expect(body).toContain('rating **4**');
        expect(body).toContain('no reactions/replies');
    });
});

/**
 * JUNIE-5625: the session id from an unsigned PR comment marker was joined into the Junie working
 * directory, so `session=../../checkout` ran Junie (and the PR's project MCP servers) in the PR checkout.
 */
describe('JUNIE-5625: feedback session ids cannot escape the working directory', () => {
    const tokenFor = (sid: string, rid: unknown = 1) =>
        `${Buffer.from(JSON.stringify({ sid, rid })).toString('base64url')}.sig`;

    test('marker with a path-like session id is ignored', () => {
        const token = tokenFor('signed-session');
        for (const session of ['../../../../checkout', 'a/b', 'a\\b', '.', '..', 'x.y']) {
            const body = `<!-- junie-feedback:session=${session};run=4242;token=${token} -->`;
            expect(parseFeedbackMarker(body)).toBeUndefined();
            expect(resolveSessionIdentity(body)).toBeUndefined();
        }
        expect(parseFeedbackMarker(`<!-- junie-feedback:session=s1;run=../x;token=${token} -->`)).toBeUndefined();
        expect(parseInlineFeedbackRunId('<!-- junie-inline-feedback:run=../x -->')).toBeUndefined();
    });

    test('token claims with a path-like session or run id are ignored', () => {
        expect(parseFeedbackTokenClaims(tokenFor('../../checkout'))).toBeUndefined();
        expect(parseFeedbackTokenClaims(tokenFor('s1', '../x'))).toBeUndefined();
        const body = `[Share feedback](https://x/code-review-feedback?token=${tokenFor('../../checkout')})`;
        expect(resolveSessionIdentity(body)?.sessionId).toMatch(/^token-[0-9a-f]{16}$/);
    });

    test('real session ids are still accepted', () => {
        const body = createCodeReviewFeedbackMarker('session-260727-151332-1bxm', 30278879175, 'abc.def');
        expect(parseFeedbackMarker(body)?.sessionId).toBe('session-260727-151332-1bxm');
    });

    const processWithVerifyResponse = async (sessionId: string, token: string, verifyResponse: object) => {
        const fetchMock = mock(async () =>
            new Response(JSON.stringify(verifyResponse), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as typeof fetch;
        try {
            // No comments: a session that passes the token checks ends as skipped_empty
            return await processSession(
                { sessionId, runId: '4242', token, comments: [] },
                { octokit: {} as never, owner: 'o', repo: 'r', prNumber: 1, workingDir: '/tmp/unused' },
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    };

    test('a valid token is not accepted for a different session', async () => {
        const outcome = await processWithVerifyResponse('other-session', 'tok.en', {
            valid: true, alreadySubmitted: false, sessionId: 'signed-session',
        });
        expect(outcome.status).toBe('skipped_invalid_token');
        expect(outcome.detail).toContain('another session');
    });

    test('a marker cannot opt out of the binding with a token- prefix', async () => {
        const outcome = await processWithVerifyResponse('token-attacker', 'tok.en', {
            valid: true, alreadySubmitted: false, sessionId: 'signed-session',
        });
        expect(outcome.status).toBe('skipped_invalid_token');
    });

    test('a marker session is not accepted when verify does not name the session', async () => {
        const outcome = await processWithVerifyResponse('signed-session', 'tok.en', { valid: true, alreadySubmitted: false });
        expect(outcome.status).toBe('skipped_invalid_token');
    });

    test('the matching session and the token-derived session are accepted', async () => {
        const matching = await processWithVerifyResponse('signed-session', 'tok.en', {
            valid: true, alreadySubmitted: false, sessionId: 'signed-session',
        });
        expect(matching.status).toBe('skipped_empty');

        const derived = await processWithVerifyResponse(tokenDerivedSessionId('tok.en'), 'tok.en', { valid: true });
        expect(derived.status).toBe('skipped_empty');
    });
});
