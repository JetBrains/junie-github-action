import { describe, expect, mock, test } from 'bun:test';
import {
    DEFAULT_CODE_REVIEW_FEEDBACK_API_BASE_URL,
    fetchCodeReviewFeedbackLink,
    isJunieEap,
    resolveCodeReviewFeedbackApiBaseUrl,
} from '../src/utils/code-review-feedback-link';

describe('code-review-feedback-link', () => {
    test('resolveCodeReviewFeedbackApiBaseUrl uses default and strips trailing slash', () => {
        expect(resolveCodeReviewFeedbackApiBaseUrl()).toBe(DEFAULT_CODE_REVIEW_FEEDBACK_API_BASE_URL);
        expect(resolveCodeReviewFeedbackApiBaseUrl('https://junie-kitty.labs.jb.gg/api/public/no-auth/'))
            .toBe('https://junie-kitty.labs.jb.gg/api/public/no-auth');
    });

    test('isJunieEap accepts only JUNP', () => {
        expect(isJunieEap('JUNP')).toBe(true);
        expect(isJunieEap('TRIAL')).toBe(false);
        expect(isJunieEap('AIP')).toBe(false);
        expect(isJunieEap(undefined)).toBe(false);
    });

    test('fetchCodeReviewFeedbackLink returns link from junie-cloud BFF', async () => {
        const fetchMock = mock(() =>
            Promise.resolve(
                new Response(JSON.stringify({ link: 'https://junie.jetbrains.com/code-review-feedback?token=abc.def' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            ),
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as typeof fetch;

        try {
            const link = await fetchCodeReviewFeedbackLink({
                sessionId: 'session-abc',
                repository: 'org/repo',
                prNumber: 12,
                runId: 999,
                apiToken: 'perm-test-token',
            });

            expect(link).toBe('https://junie.jetbrains.com/code-review-feedback?token=abc.def');
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toBe(`${DEFAULT_CODE_REVIEW_FEEDBACK_API_BASE_URL}/code-review-feedback/create-link`);
            expect(init.method).toBe('POST');
            expect(init.headers).toMatchObject({
                'Content-Type': 'application/json',
                Authorization: 'Bearer perm-test-token',
            });
            expect(JSON.parse(String(init.body))).toEqual({
                sessionId: 'session-abc',
                repository: 'org/repo',
                prNumber: 12,
                runId: 999,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('fetchCodeReviewFeedbackLink returns undefined on non-2xx', async () => {
        const fetchMock = mock(() => Promise.resolve(new Response('', { status: 403 })));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as typeof fetch;

        try {
            const link = await fetchCodeReviewFeedbackLink({
                sessionId: 'session-abc',
                repository: 'org/repo',
                prNumber: 12,
                runId: 999,
                apiToken: 'perm-test-token',
            });
            expect(link).toBeUndefined();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
