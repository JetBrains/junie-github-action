import {GITHUB_SERVER_URL} from "../../api/config";
import {createJunieCommentMarker, INIT_COMMENT_BODY} from "../../../constants/github";

export function createJobRunLink(
    owner: string,
    repo: string,
    runId: string,
): string {
    const jobRunUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${runId}`;
    return `[View job run](${jobRunUrl})`;
}

export function createBranchLink(
    owner: string,
    repo: string,
    branchName: string,
): string {
    const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${branchName}`;
    return `\n[View branch](${branchUrl})`;
}

export function createCommentBody(
    jobRunLink: string,
    workflowName: string
): string {
    return addJunieMarker(`${INIT_COMMENT_BODY}

${jobRunLink}`, workflowName);
}

/**
 * Adds Junie comment marker to the comment body for identification.
 * This allows finding Junie comments even when different tokens or bots are used.
 *
 * @param body - Comment body text
 * @param workflowName - Name of the GitHub Actions workflow
 */
export function addJunieMarker(body: string, workflowName: string): string {
    const marker = createJunieCommentMarker(workflowName);
    // If marker already exists, don't add it again
    if (body.includes(marker)) {
        return body;
    }
    return `${marker}\n${body}`;
}

/**
 * Checks if a comment body contains the Junie marker for this workflow.
 *
 * @param body - Comment body text
 * @param workflowName - Name of the GitHub Actions workflow
 */
export function hasJunieMarker(body: string, workflowName: string): boolean {
    const marker = createJunieCommentMarker(workflowName);
    return body.includes(marker);
}
