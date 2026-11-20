/**
 * Parse / match hidden markers used to correlate Junie code-review feedback
 * across summary comments and inline review comments.
 */

export interface FeedbackMarkerData {
    sessionId: string;
    runId: string;
    token?: string;
}

export interface FeedbackTokenClaims {
    sessionId: string;
    runId: string;
    repository?: string;
    prNumber?: number;
}

/**
 * Session and run ids come from PR comments anyone can post and end up in file system paths, so
 * only plain identifier characters are accepted: no `/`, `\` or `.` (JUNIE-5625).
 */
const SAFE_FEEDBACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** session + run + optional token (token needed when Share feedback link is hidden). */
const FEEDBACK_MARKER_RE =
    /<!--\s*junie-feedback:session=([A-Za-z0-9_-]{1,128});run=([A-Za-z0-9_-]{1,128})(?:;token=([^>\s]+))?\s*-->/i;
const INLINE_FEEDBACK_MARKER_RE =
    /<!--\s*junie-inline-feedback:run=([A-Za-z0-9_-]{1,128})\s*-->/i;
const FEEDBACK_TOKEN_IN_URL_RE =
    /code-review-feedback\?token=([A-Za-z0-9._~\-%=]+)/i;

export function isSafeFeedbackId(value: string): boolean {
    return SAFE_FEEDBACK_ID_RE.test(value);
}

export function parseFeedbackMarker(body: string): FeedbackMarkerData | undefined {
    const match = body.match(FEEDBACK_MARKER_RE);
    if (!match) {
        return undefined;
    }
    return {
        sessionId: match[1],
        runId: match[2],
        token: match[3] || undefined,
    };
}

export function parseInlineFeedbackRunId(body: string): string | undefined {
    const match = body.match(INLINE_FEEDBACK_MARKER_RE);
    return match?.[1];
}

export function extractFeedbackTokenFromBody(body: string): string | undefined {
    const fromMarker = parseFeedbackMarker(body)?.token;
    if (fromMarker) {
        return fromMarker;
    }

    const match = body.match(FEEDBACK_TOKEN_IN_URL_RE);
    if (!match) {
        return undefined;
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

/**
 * Feedback tokens are `base64url(json).hmac`. Recover sid/rid when the HTML marker is missing.
 */
export function parseFeedbackTokenClaims(token: string): FeedbackTokenClaims | undefined {
    const payloadPart = token.split('.')[0];
    if (!payloadPart) {
        return undefined;
    }

    try {
        const json = Buffer.from(payloadPart, 'base64url').toString('utf-8');
        const parsed = JSON.parse(json) as { sid?: unknown; rid?: unknown; repo?: unknown; pr?: unknown };
        const sessionId = typeof parsed.sid === 'string' ? parsed.sid : undefined;
        const runId = parsed.rid != null ? String(parsed.rid) : undefined;
        if (!sessionId || !runId || !isSafeFeedbackId(sessionId) || !isSafeFeedbackId(runId)) {
            return undefined;
        }
        return {
            sessionId,
            runId,
            repository: typeof parsed.repo === 'string' ? parsed.repo : undefined,
            prNumber: typeof parsed.pr === 'number' ? parsed.pr : undefined,
        };
    } catch {
        return undefined;
    }
}

export function hasJunieBotCommentMarker(body: string): boolean {
    return /<!--\s*junie-bot-comment:/i.test(body);
}

export function hasAgentReviewCommentMarker(body: string): boolean {
    return body.trimEnd().endsWith('<!-- junie-review-comment -->');
}
