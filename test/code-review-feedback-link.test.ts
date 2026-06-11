import { describe, expect, mock, test } from 'bun:test';
import {
    fetchCodeReviewFeedbackLink,
    JUNIE_CLOUD_PUBLIC_API_URL,
    isJunieEap,
} from '../src/utils/code-review-feedback-link';

describe('code-review-feedback-link', () => {
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
            expect(url).toBe(`${JUNIE_CLOUD_PUBLIC_API_URL}/code-review-feedback/create-link`);
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
