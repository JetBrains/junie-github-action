/**
 * Parse / match hidden markers used to correlate Junie code-review feedback
 * across summary comments and inline review comments.
 */

export interface FeedbackMarkerData {
    sessionId: string;
    runId: string;
}

const FEEDBACK_MARKER_RE =
    /<!--\s*junie-feedback:session=([^;>\s]+);run=([^;>\s]+)\s*-->/i;
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
    };
}

export function parseInlineFeedbackRunId(body: string): string | undefined {
    const match = body.match(INLINE_FEEDBACK_MARKER_RE);
    return match?.[1];
}

export function extractFeedbackTokenFromBody(body: string): string | undefined {
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

export function hasJunieBotCommentMarker(body: string): boolean {
    return /<!--\s*junie-bot-comment:/i.test(body);
}
