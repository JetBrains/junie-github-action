/** Default junie-cloud BFF URL for code review feedback (production). */
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
