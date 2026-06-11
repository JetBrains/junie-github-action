/** Production junie-cloud BFF URL for code review feedback */
export const JUNIE_CLOUD_PUBLIC_API_URL = 'https://junie.jetbrains.com/api/public/no-auth';

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

export function isJunieEap(licenseType?: string): boolean {
    return licenseType === 'JUNP';
}

export async function fetchCodeReviewFeedbackLink(
    params: FetchCodeReviewFeedbackLinkParams,
): Promise<string | undefined> {
    try {
        const response = await fetch(`${JUNIE_CLOUD_PUBLIC_API_URL}/code-review-feedback/create-link`, {
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
            console.log(`Skipping code review feedback link: junie-cloud returned ${response.status}`);
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
