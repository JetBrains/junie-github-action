import type {Octokit} from '@octokit/rest';
import type {SessionCollectOutcome} from './types';

/** Hidden marker to identify auto-collect outcome comments. */
export const AUTO_COLLECT_NOTIFY_MARKER = '<!-- junie-auto-collect-feedback -->';

function formatOutcomeLine(outcome: SessionCollectOutcome): string {
    switch (outcome.status) {
        case 'submitted':
            return `- Session \`${outcome.sessionId}\`: auto-collected feedback submitted (rating **${outcome.rating}**).`;
        case 'already_submitted':
            return `- Session \`${outcome.sessionId}\`: feedback was already submitted - skipped.`;
        case 'skipped_empty':
            return `- Session \`${outcome.sessionId}\`: no reactions/replies on Junie review - feedback not auto-submitted.`;
        case 'skipped_ambiguous':
            return `- Session \`${outcome.sessionId}\`: could not confidently auto-collect feedback (${outcome.detail || 'mixed signals'}).`;
        case 'skipped_invalid_token':
            return `- Session \`${outcome.sessionId}\`: feedback token missing/invalid - skipped.`;
        case 'submit_failed':
            return `- Session \`${outcome.sessionId}\`: submit failed (${outcome.detail || 'unknown error'}).`;
        default:
            return `- Session \`${outcome.sessionId}\`: ${outcome.status}`;
    }
}

export function buildAutoCollectNotificationBody(outcomes: SessionCollectOutcome[]): string {
    const title = '### Junie auto-collect feedback';

    const content = outcomes.length === 0
        ? `${title}\n\nNo Junie code-review feedback sessions found on this PR.`
        : [title, '', ...outcomes.map(formatOutcomeLine)].join('\n');

    return `${AUTO_COLLECT_NOTIFY_MARKER}\n${content}`;
}

/** Always create a new comment so the outcome appears at the bottom of the PR timeline. */
export async function postAutoCollectNotification(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    outcomes: SessionCollectOutcome[],
): Promise<void> {
    const body = buildAutoCollectNotificationBody(outcomes);

    await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
    });
    console.log(`Posted auto-collect notification on PR #${prNumber}`);
}
