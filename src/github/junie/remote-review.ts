import {isCodeReviewEvent, JunieExecutionContext} from "../context";

/**
 * First Junie CLI build that can review a remote Pull Request (`codeReviewTask.reviewTarget`) and post
 * inline comments itself. Older builds reject unknown input fields, so they keep using the MCP comment tool.
 */
const MIN_REMOTE_REVIEW_VERSION = 3419;

/** `latest` installs the nightly build; an unparseable version is treated as an old one. */
export function supportsRemoteReview(version: string): boolean {
    return version.trim() === "latest" || parseInt(version, 10) >= MIN_REMOTE_REVIEW_VERSION;
}

/**
 * In a remote review the CLI posts inline comments with its own `post_inline_review_comment` tool.
 * An MCP tool with the same name makes the CLI drop its native one, so the MCP comment server must not be started.
 */
export function isRemoteReview(context: JunieExecutionContext): boolean {
    return isCodeReviewEvent(context) && supportsRemoteReview(context.inputs.junieVersion);
}
