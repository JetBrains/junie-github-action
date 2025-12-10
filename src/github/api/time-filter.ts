/**
 * Time-based filtering utilities to prevent security attacks via post-trigger content edits.
 *
 * These filters ensure that only content that existed in its final state BEFORE the trigger event
 * is included. This prevents malicious actors from editing comments/reviews after an authorized
 * user triggers the bot but before the bot processes the request.
 */

/**
 * Filters comments to only include those created and edited before trigger time.
 * Works for both timeline comments and review comments.
 */
export function filterCommentsToTriggerTime<
    T extends { createdAt: string; lastEditedAt?: string | null }
>(comments: T[], triggerTime: string | undefined): T[] {
    if (!triggerTime) return comments;

    const triggerTimestamp = new Date(triggerTime).getTime();

    return comments.filter((comment) => {
        // Comment must have been created before or at trigger time (not after)
        const createdTimestamp = new Date(comment.createdAt).getTime();
        if (createdTimestamp > triggerTimestamp) {
            return false;
        }

        // If comment has been edited, the edit must have occurred before or at trigger time
        if (comment.lastEditedAt) {
            const lastEditTimestamp = new Date(comment.lastEditedAt).getTime();
            if (lastEditTimestamp > triggerTimestamp) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Filters reviews to only include those submitted and edited before trigger time
 */
export function filterReviewsToTriggerTime<
    T extends { submittedAt: string; lastEditedAt?: string | null }
>(reviews: T[], triggerTime: string | undefined): T[] {
    if (!triggerTime) return reviews;

    const triggerTimestamp = new Date(triggerTime).getTime();

    return reviews.filter((review) => {
        // Review must have been submitted before or at trigger time (not after)
        const submittedTimestamp = new Date(review.submittedAt).getTime();
        if (submittedTimestamp > triggerTimestamp) {
            return false;
        }

        // If review body has been edited, the edit must have occurred before or at trigger time
        if (review.lastEditedAt) {
            const lastEditTimestamp = new Date(review.lastEditedAt).getTime();
            if (lastEditTimestamp > triggerTimestamp) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Checks if the issue/PR body is safe to use (wasn't edited after trigger time)
 */
export function isBodySafeToUse(
    contextData: { createdAt: string; lastEditedAt?: string | null },
    triggerTime: string | undefined
): boolean {
    // If no trigger time, allow the body (backwards compatibility)
    if (!triggerTime) return true;

    const triggerTimestamp = new Date(triggerTime).getTime();

    // Check if the body was edited after the trigger
    if (contextData.lastEditedAt) {
        const lastEditTimestamp = new Date(contextData.lastEditedAt).getTime();
        if (lastEditTimestamp > triggerTimestamp) {
            return false;
        }
    }

    return true;
}
