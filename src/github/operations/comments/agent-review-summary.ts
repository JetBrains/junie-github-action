import type {Octokit} from "@octokit/rest";
import {AGENT_CODE_REVIEW_SUMMARY_MARKERS} from "../../../constants/github";
import {JunieExecutionContext} from "../../context";

export async function isReviewSummaryPublishedByAgent(
    octokit: Octokit,
    context: JunieExecutionContext,
    initCommentId: number,
): Promise<boolean> {
    const {owner, name} = context.payload.repository;
    const issueNumber = context.entityNumber;
    if (!issueNumber) {
        return false;
    }

    try {
        const {data: initComment} = await octokit.rest.issues.getComment({
            owner: owner.login,
            repo: name,
            comment_id: initCommentId,
        });
        const initCommentUpdatedAt = Date.parse(initComment.updated_at);
        if (!Number.isFinite(initCommentUpdatedAt)) {
            return false;
        }

        for (let page = 1; ; page++) {
            const {data: comments} = await octokit.rest.issues.listComments({
                owner: owner.login,
                repo: name,
                issue_number: issueNumber,
                per_page: 100,
                page,
            });
            const hasCurrentSummary = comments.some(comment => {
                const body = comment.body;
                if (!body || !AGENT_CODE_REVIEW_SUMMARY_MARKERS.some(marker => body.startsWith(marker))) {
                    return false;
                }

                return Date.parse(comment.updated_at) >= initCommentUpdatedAt;
            });
            if (hasCurrentSummary) {
                return true;
            }
            if (comments.length < 100) {
                return false;
            }
        }
    } catch (error) {
        console.warn("Failed to check for an agent review summary; keeping the completion summary:", error);
        return false;
    }
}
