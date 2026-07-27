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

/** session + run + optional token (token needed when Share feedback link is hidden). */
const FEEDBACK_MARKER_RE =
    /<!--\s*junie-feedback:session=([^;>\s]+);run=([^;>\s]+)(?:;token=([^>\s]+))?\s*-->/i;
const INLINE_FEEDBACK_MARKER_RE =
    /<!--\s*junie-inline-feedback:run=([^;>\s]+)\s*-->/i;
const FEEDBACK_TOKEN_IN_URL_RE =
    /code-review-feedback\?token=([A-Za-z0-9._~\-%=]+)/i;

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
        const padded = payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4);
        const json = Buffer.from(padded, 'base64url').toString('utf-8');
        const parsed = JSON.parse(json) as { sid?: unknown; rid?: unknown; repo?: unknown; pr?: unknown };
        const sessionId = typeof parsed.sid === 'string' ? parsed.sid : undefined;
        const runId = parsed.rid != null ? String(parsed.rid) : undefined;
        if (!sessionId || !runId) {
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
