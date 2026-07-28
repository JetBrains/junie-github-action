export type ReactionContent =
    | '+1'
    | '-1'
    | 'laugh'
    | 'confused'
    | 'heart'
    | 'hooray'
    | 'rocket'
    | 'eyes';

export interface CollectedReaction {
    content: ReactionContent | string;
    userLogin: string;
    userType?: string;
}

export interface CollectedComment {
    id: number;
    kind: 'summary' | 'inline' | 'reply';
    body: string;
    userLogin: string;
    htmlUrl?: string;
    path?: string;
    reactions: CollectedReaction[];
}

export interface SessionFeedbackSignals {
    sessionId: string;
    runId: string;
    token?: string;
    summaryCommentId?: number;
    comments: CollectedComment[];
}

export type CollectorVerdictKind =
    | 'obvious_positive'
    | 'obvious_negative'
    | 'ambiguous'
    | 'text_only'
    | 'empty';

export interface CollectorVerdict {
    kind: CollectorVerdictKind;
    rating?: number;
    thumbsUp: number;
    thumbsDown: number;
    replyTexts: string[];
    needsAgent: boolean;
}

export interface AgentFeedbackResult {
    rating: number;
    comment: string;
    confidence: 'high' | 'medium' | 'low';
    rationale?: string;
}

export type SessionCollectOutcomeStatus =
    | 'submitted'
    | 'already_submitted'
    | 'skipped_empty'
    | 'skipped_ambiguous'
    | 'skipped_invalid_token'
    | 'submit_failed';

export interface SessionCollectOutcome {
    sessionId: string;
    runId: string;
    status: SessionCollectOutcomeStatus;
    rating?: number;
    /** Comment that was sent to BFF submit */
    comment?: string;
    detail?: string;
}
