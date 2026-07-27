/** Production junie-cloud BFF URL for code-review feedback create-link. Used when the workflow input / env is unset. */
export const DEFAULT_CODE_REVIEW_FEEDBACK_API_BASE_URL =
    'https://junie.jetbrains.com/api/public/no-auth';

export function resolveCodeReviewFeedbackApiBaseUrl(
    configuredBaseUrl?: string,
): string {
    const trimmed = configuredBaseUrl?.trim();
    if (trimmed) {
        return trimmed.replace(/\/+$/, '');
    }
    return DEFAULT_CODE_REVIEW_FEEDBACK_API_BASE_URL;
}

export interface FetchCodeReviewFeedbackLinkParams {
    sessionId: string;
    repository: string;
    prNumber: number;
    runId: number;
    apiToken: string;
}

function buildAuthorizationHeader(apiToken: string): string {
    const trimmed = apiToken.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('bearer ') || lower.startsWith('github ') || lower.startsWith('kineto ')) {
        return trimmed;
    }
    return `Bearer ${trimmed}`;
}

export async function fetchCodeReviewFeedbackLink(
    params: FetchCodeReviewFeedbackLinkParams,
    apiBaseUrl?: string,
): Promise<string | undefined> {
    const baseUrl = resolveCodeReviewFeedbackApiBaseUrl(apiBaseUrl);
    try {
        const response = await fetch(`${baseUrl}/code-review-feedback/create-link`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: buildAuthorizationHeader(params.apiToken),
            },
            body: JSON.stringify({
                sessionId: params.sessionId,
                repository: params.repository,
                prNumber: params.prNumber,
                runId: params.runId,
            }),
        });

        if (!response.ok) {
            if (response.status === 403) {
                console.log(
                    `Skipping code review feedback link: not available for this license (junie-cloud returned ${response.status}). ` +
                    'This is expected for non-EAP (non-JUNP) licenses and is not a backend error.',
                );
            } else {
                console.log(`Skipping code review feedback link: junie-cloud returned ${response.status}`);
            }
            return undefined;
        }

        const data = (await response.json()) as { link?: string };
        return data.link;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`Skipping code review feedback link: ${message}`);
        return undefined;
    }
}

export interface VerifyCodeReviewFeedbackResponse {
    valid: boolean;
    sessionId?: string;
    repository?: string;
    prNumber?: number;
    runId?: number;
    alreadySubmitted?: boolean;
}

export interface SubmitCodeReviewFeedbackParams {
    token: string;
    rating: number;
    comment?: string;
}

export interface SubmitCodeReviewFeedbackResponse {
    success: boolean;
    error?: string;
}

export async function verifyCodeReviewFeedbackToken(
    token: string,
    apiBaseUrl?: string,
): Promise<VerifyCodeReviewFeedbackResponse> {
    const baseUrl = resolveCodeReviewFeedbackApiBaseUrl(apiBaseUrl);
    const url = `${baseUrl}/code-review-feedback/verify?token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Feedback verify failed with status ${response.status}`);
    }
    return (await response.json()) as VerifyCodeReviewFeedbackResponse;
}

export async function submitCodeReviewFeedback(
    params: SubmitCodeReviewFeedbackParams,
    apiBaseUrl?: string,
): Promise<SubmitCodeReviewFeedbackResponse> {
    const baseUrl = resolveCodeReviewFeedbackApiBaseUrl(apiBaseUrl);
    const response = await fetch(`${baseUrl}/code-review-feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: params.token,
            rating: params.rating,
            comment: params.comment,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
            success: false,
            error: `submit failed with status ${response.status}${text ? `: ${text}` : ''}`,
        };
    }

    return (await response.json()) as SubmitCodeReviewFeedbackResponse;
}
