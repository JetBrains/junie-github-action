/** Production ingrazzio URL — same as Junie CLI ProductionEnvironment.ingrazzioUrl */
export const INGRAZZIO_PRODUCTION_URL = 'https://ingrazzio-cloud-prod.labs.jb.gg';

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

export function shouldOfferCodeReviewFeedback(licenseType?: string): boolean {
    return licenseType === 'JUNP';
}

export async function fetchCodeReviewFeedbackLink(
    params: FetchCodeReviewFeedbackLinkParams,
): Promise<string | undefined> {
    try {
        const response = await fetch(`${INGRAZZIO_PRODUCTION_URL}/api/code-review-feedback/create-link`, {
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
            console.log(`Skipping code review feedback link: ingrazzio returned ${response.status}`);
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
