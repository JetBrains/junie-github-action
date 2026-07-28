import type {Octokit} from '@octokit/rest';
import {
    submitCodeReviewFeedback,
    verifyCodeReviewFeedbackToken,
} from '../../../../utils/code-review-feedback-link';
import {runAgentFeedbackEnrichment} from './agent';
import {collectSessionFeedbackSignals} from './collector';
import {buildAutoCollectedComment, evaluateCollectorVerdict} from './mapping';
import {postAutoCollectNotification} from './notify';
import type {SessionCollectOutcome, SessionFeedbackSignals} from './types';

export interface AutoCollectOptions {
    octokit: Octokit;
    owner: string;
    repo: string;
    prNumber: number;
    apiBaseUrl?: string;
    workingDir: string;
    cliToken?: string;
    junieFlags?: string;
}

async function processSession(
    signals: SessionFeedbackSignals,
    options: AutoCollectOptions,
): Promise<SessionCollectOutcome> {
    const base: Pick<SessionCollectOutcome, 'sessionId' | 'runId'> = {
        sessionId: signals.sessionId,
        runId: signals.runId,
    };

    if (!signals.token) {
        return { ...base, status: 'skipped_invalid_token', detail: 'no feedback token on PR' };
    }

    try {
        const verify = await verifyCodeReviewFeedbackToken(signals.token, options.apiBaseUrl);
        if (!verify.valid) {
            return { ...base, status: 'skipped_invalid_token', detail: 'token invalid or expired' };
        }
        if (verify.alreadySubmitted) {
            return { ...base, status: 'already_submitted' };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ...base, status: 'skipped_invalid_token', detail: message };
    }

    const verdict = evaluateCollectorVerdict(signals);
    console.log(
        `Session ${signals.sessionId}: verdict=${verdict.kind} 👍${verdict.thumbsUp} 👎${verdict.thumbsDown}`,
    );

    if (verdict.kind === 'empty') {
        return { ...base, status: 'skipped_empty' };
    }

    let rating = verdict.rating;
    let agentComment: string | undefined;

    if (verdict.needsAgent) {
        const agentResult = await runAgentFeedbackEnrichment({
            signals,
            verdict,
            workingDir: options.workingDir,
            cliToken: options.cliToken,
            junieFlags: options.junieFlags,
        });

        if (!agentResult || agentResult.confidence === 'low') {
            return {
                ...base,
                status: 'skipped_ambiguous',
                detail: agentResult
                    ? `agent confidence=low (${agentResult.rationale || 'no rationale'})`
                    : 'agent unavailable or unparseable',
            };
        }

        rating = agentResult.rating;
        agentComment = agentResult.comment;
    }

    if (!rating) {
        return {
            ...base,
            status: 'skipped_ambiguous',
            detail: 'no rating produced',
        };
    }

    const comment = buildAutoCollectedComment(verdict, agentComment);

    const submitResult = await submitCodeReviewFeedback(
        { token: signals.token, rating, comment },
        options.apiBaseUrl,
    );

    if (!submitResult.success) {
        return {
            ...base,
            status: 'submit_failed',
            detail: submitResult.error,
            rating,
            comment,
        };
    }

    return { ...base, status: 'submitted', rating, comment };
}

export async function runAutoCollectFeedback(options: AutoCollectOptions): Promise<SessionCollectOutcome[]> {
    const { octokit, owner, repo, prNumber } = options;
    console.log(`Auto-collecting code-review feedback for ${owner}/${repo}#${prNumber}`);

    const sessions = await collectSessionFeedbackSignals(octokit, owner, repo, prNumber);
    console.log(`Found ${sessions.length} feedback session(s)`);

    const outcomes: SessionCollectOutcome[] = [];
    for (const session of sessions) {
        outcomes.push(await processSession(session, options));
    }

    await postAutoCollectNotification(octokit, owner, repo, prNumber, outcomes);
    return outcomes;
}
