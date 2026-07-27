import type {CollectorVerdict, CollectedComment, CollectedReaction, SessionFeedbackSignals} from './types';

const BOT_LOGINS = new Set([
    'github-actions[bot]',
    'junie-agent',
    'junie[bot]',
]);

function isBotActor(reaction: CollectedReaction): boolean {
    if (reaction.userType === 'Bot') {
        return true;
    }
    const login = reaction.userLogin.toLowerCase();
    return BOT_LOGINS.has(login) || login.endsWith('[bot]');
}

export function countHumanThumbs(comments: CollectedComment[]): { thumbsUp: number; thumbsDown: number } {
    let thumbsUp = 0;
    let thumbsDown = 0;

    for (const comment of comments) {
        for (const reaction of comment.reactions) {
            if (isBotActor(reaction)) {
                continue;
            }
            if (reaction.content === '+1') {
                thumbsUp += 1;
            } else if (reaction.content === '-1') {
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
    const evidence = `👍×${verdict.thumbsUp} 👎×${verdict.thumbsDown}, replies: ${verdict.replyTexts.length}`;
    const parts = [
        `[auto-collected from PR reactions/replies] (${evidence})`,
    ];

    if (agentComment?.trim()) {
        parts.push(agentComment.trim());
    } else if (verdict.replyTexts.length > 0) {
        parts.push(verdict.replyTexts.join('\n---\n'));
    }

    return parts.join('\n\n').slice(0, 4000);
}
