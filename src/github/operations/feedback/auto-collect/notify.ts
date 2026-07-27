import type {Octokit} from '@octokit/rest';
import type {SessionCollectOutcome} from './types';

function formatOutcomeLine(outcome: SessionCollectOutcome): string {
    switch (outcome.status) {
        case 'submitted':
            return `- Session \`${outcome.sessionId}\`: auto-collected feedback submitted (rating **${outcome.rating}**).`;
        case 'dry_run':
            return `- Session \`${outcome.sessionId}\`: **dry-run** — would submit rating **${outcome.rating}** (not sent).`;
        case 'already_submitted':
            return `- Session \`${outcome.sessionId}\`: feedback was already submitted — skipped.`;
        case 'skipped_empty':
            return `- Session \`${outcome.sessionId}\`: no reactions/replies on Junie review — feedback not auto-submitted.`;
        case 'skipped_ambiguous':
            return `- Session \`${outcome.sessionId}\`: could not confidently auto-collect feedback (${outcome.detail || 'mixed signals'}).`;
        case 'skipped_invalid_token':
            return `- Session \`${outcome.sessionId}\`: feedback token missing/invalid — skipped.`;
        case 'submit_failed':
            return `- Session \`${outcome.sessionId}\`: submit failed (${outcome.detail || 'unknown error'}).`;
        default:
            return `- Session \`${outcome.sessionId}\`: ${outcome.status}`;
    }
}

function formatDryRunPayload(outcome: SessionCollectOutcome): string[] {
    if (outcome.status !== 'dry_run' || outcome.rating == null) {
        return [];
    }

    return [
        '',
        `#### Dry-run payload — session \`${outcome.sessionId}\` (run \`${outcome.runId}\`)`,
        '',
        `- **rating:** ${outcome.rating}`,
        outcome.alreadySubmittedOnBackend
            ? '- **note:** backend already has a submission for this session (submit would be rejected)'
            : '- **note:** BFF submit was skipped (dry-run)',
        '',
        '**comment that would be sent:**',
        '```',
        outcome.comment || '(empty)',
        '```',
    ];
}

export function buildAutoCollectNotificationBody(
    outcomes: SessionCollectOutcome[],
    options?: { dryRun?: boolean },
): string {
    const dryRun = options?.dryRun === true;
    const title = dryRun
        ? '### Junie auto-collect feedback (dry-run)'
        : '### Junie auto-collect feedback';

    if (outcomes.length === 0) {
        return `${title}\n\nNo Junie code-review feedback sessions found on this PR.`;
    }

    const body = [
        title,
        '',
        ...(dryRun
            ? [
                '> Dry-run mode: feedback was **not** submitted to the BFF. Below is what would have been sent.',
                '',
            ]
            : []),
        ...outcomes.map(formatOutcomeLine),
        ...outcomes.flatMap(formatDryRunPayload),
    ];

    return body.join('\n');
}

export async function postAutoCollectNotification(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    outcomes: SessionCollectOutcome[],
    options?: { dryRun?: boolean },
): Promise<void> {
    const body = buildAutoCollectNotificationBody(outcomes, options);
    await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
    });
    console.log(`Posted auto-collect notification on PR #${prNumber}`);
}
