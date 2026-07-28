import {GITHUB_ACTIONS_BOT, JUNIE_AGENT} from '../../../../constants/github';
import type {CollectorVerdict, CollectedComment, CollectedReaction, SessionFeedbackSignals} from './types';

const BOT_LOGINS = new Set([
    GITHUB_ACTIONS_BOT.login.toLowerCase(),
    JUNIE_AGENT.login.toLowerCase(),
    'junie[bot]',
]);

function isBotActor(reaction: CollectedReaction): boolean {
    if (reaction.userType === 'Bot') {
        return true;
    }
    const login = reaction.userLogin.toLowerCase();
    return BOT_LOGINS.has(login) || login.endsWith('[bot]');
}

/**
 * Positive: 👍 (+1), ❤️ (heart). Negative: 👎 (-1), 😕 (confused).
 * GitHub has no dedicated "sad" reaction; confused is the closest negative face.
 */
export function countHumanThumbs(comments: CollectedComment[]): { thumbsUp: number; thumbsDown: number } {
    let thumbsUp = 0;
    let thumbsDown = 0;

    for (const comment of comments) {
        for (const reaction of comment.reactions) {
            if (isBotActor(reaction)) {
                continue;
            }
            if (reaction.content === '+1' || reaction.content === 'heart') {
                thumbsUp += 1;
            } else if (reaction.content === '-1' || reaction.content === 'confused') {
                thumbsDown += 1;
            }
        }
    }

    return { thumbsUp, thumbsDown };
}

export function collectReplyTexts(comments: CollectedComment[], maxChars = 4000): string[] {
    const replies = comments
        .filter((c) => c.kind === 'reply')
        .map((c) => c.body.trim())
        .filter(Boolean);

    const result: string[] = [];
    let used = 0;
    for (const reply of replies) {
        if (used >= maxChars) {
            break;
        }
        const slice = reply.slice(0, maxChars - used);
        result.push(slice);
        used += slice.length;
    }
    return result;
}

/**
 * Short extractive summary for BFF submit when the agent is not used
 * (obvious thumbs-up/down). Avoids dumping full reply bodies into the DB.
 */
export function summarizeReplyTexts(replyTexts: string[], maxChars = 400): string | undefined {
    if (replyTexts.length === 0) {
        return undefined;
    }

    const maxSnippets = Math.min(replyTexts.length, 3);
    const omittedEstimate = Math.max(0, replyTexts.length - maxSnippets);
    const suffixReserve = omittedEstimate > 0 ? ` (+${omittedEstimate} more)`.length : 0;
    const budget = Math.max(40, maxChars - suffixReserve);

    const snippets: string[] = [];
    let used = 0;
    const perReplyBudget = Math.max(60, Math.floor(budget / maxSnippets));

    for (const reply of replyTexts) {
        if (used >= budget || snippets.length >= maxSnippets) {
            break;
        }
        const normalized = reply.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            continue;
        }
        // Account for "; " separators between snippets.
        const separatorCost = snippets.length > 0 ? 2 : 0;
        const room = Math.min(perReplyBudget, budget - used - separatorCost);
        if (room <= 1) {
            break;
        }
        const snippet = normalized.length > room
            ? `${normalized.slice(0, room - 1).trimEnd()}…`
            : normalized;
        snippets.push(snippet);
        used += separatorCost + snippet.length;
    }

    if (snippets.length === 0) {
        return undefined;
    }

    const omitted = replyTexts.length - snippets.length;
    const suffix = omitted > 0 ? ` (+${omitted} more)` : '';
    return `${snippets.join('; ')}${suffix}`;
}

/**
 * Map aggregated PR signals to a collector verdict.
 * Merge/close alone never produces a rating — only explicit reactions/replies.
 */
export function evaluateCollectorVerdict(signals: SessionFeedbackSignals): CollectorVerdict {
    const { thumbsUp, thumbsDown } = countHumanThumbs(signals.comments);
    const replyTexts = collectReplyTexts(signals.comments);
    const hasReplies = replyTexts.length > 0;

    if (thumbsUp > 0 && thumbsDown === 0) {
        return {
            kind: 'obvious_positive',
            rating: thumbsUp >= 2 ? 5 : 4,
            thumbsUp,
            thumbsDown,
            replyTexts,
            needsAgent: false,
        };
    }

    if (thumbsDown > 0 && thumbsUp === 0) {
        return {
            kind: 'obvious_negative',
            rating: thumbsDown >= 2 ? 1 : 2,
            thumbsUp,
            thumbsDown,
            replyTexts,
            needsAgent: false,
        };
    }

    if (thumbsUp > 0 && thumbsDown > 0) {
        return {
            kind: 'ambiguous',
            thumbsUp,
            thumbsDown,
            replyTexts,
            needsAgent: true,
        };
    }

    if (hasReplies) {
        return {
            kind: 'text_only',
            thumbsUp,
            thumbsDown,
            replyTexts,
            needsAgent: true,
        };
    }

    return {
        kind: 'empty',
        thumbsUp,
        thumbsDown,
        replyTexts,
        needsAgent: false,
    };
}

export function buildAutoCollectedComment(
    verdict: CollectorVerdict,
    agentComment?: string,
): string {
    const evidence = `👍❤️×${verdict.thumbsUp} 👎😕×${verdict.thumbsDown}, replies: ${verdict.replyTexts.length}`;
    const parts = [
        `[auto-collected from PR reactions/replies] (${evidence})`,
    ];

    if (agentComment?.trim()) {
        parts.push(agentComment.trim());
    } else {
        const summary = summarizeReplyTexts(verdict.replyTexts);
        if (summary) {
            parts.push(summary);
        }
    }

    return parts.join('\n\n').slice(0, 800);
}
