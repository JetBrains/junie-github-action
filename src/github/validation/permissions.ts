import * as core from "@actions/core";
import type {UserInitiatedEventContext} from "../context";
import type {Octokit} from "@octokit/rest";

/**
 * Verifies if the actor has repository access for triggering Junie workflows.
 *
 * Ensures only authorized users can trigger Junie, preventing unauthorized access.
 * GitHub Apps (actors ending with "[bot]") automatically bypass this check because the
 * collaborator permission API always reports "none" for apps. This bypass is ONLY safe because
 * `checkHumanActor` runs right after it and rejects every bot that is not listed in `allowed_bots`
 * (see JUNIE-5036). Never call this function as the sole authorization gate.
 *
 * @param octokit - Octokit REST client for GitHub API calls
 * @param context - User-initiated event context containing actor and repository information
 * @returns `true` if actor has write/admin permissions or is a GitHub App, `false` otherwise
 * @throws {Error} if unable to verify permissions (API errors, network issues)
 */
export async function verifyRepositoryAccess(
    octokit: Octokit,
    context: UserInitiatedEventContext
): Promise<boolean> {
    const {actor} = context;
    const repo = context.payload.repository;
    try {
        core.info(`Checking permissions for actor: ${actor}`);

        // GitHub Apps (ending with "[bot]") cannot be checked via the collaborator API, so they
        // skip this check. Whether a given bot is actually allowed to trigger Junie is decided by
        // checkHumanActor() + the `allowed_bots` input, which must run after this function.
        if (actor.endsWith("[bot]")) {
            core.info(`Actor is a GitHub App: ${actor}`);
            return true;
        }

        // For human users, fetch their permission level from GitHub API
        // Possible levels: admin, write, read, none
        const response = await octokit.repos.getCollaboratorPermissionLevel({
            owner: repo.owner.login,
            repo: repo.name,
            username: actor,
        });

        const permissionLevel = response.data.permission;
        core.info(`Permission level retrieved: ${permissionLevel}`);

        if (permissionLevel === "admin" || permissionLevel === "write") {
            core.info(`✓ Actor has write access: ${permissionLevel}`);
            return true;
        } else {
            const repoFullName = `${repo.owner.login}/${repo.name}`;
            core.warning(
                `❌ Actor "${actor}" has insufficient permissions: ${permissionLevel} ` +
                `(requires "write" or "admin" access to ${repoFullName})`
            );
            return false;
        }
    } catch (error) {
        const repoFullName = `${repo.owner.login}/${repo.name}`;
        core.error(`Failed to check permissions: ${error}`);

        if (error instanceof Error && error.message.includes('404')) {
            throw new Error(
                `❌ Failed to check permissions: User "${actor}" is not a collaborator on ${repoFullName}. ` +
                `Only repository collaborators with write access can trigger Junie.`
            );
        }

        throw new Error(
            `❌ Failed to check permissions for "${actor}" on ${repoFullName}. ` +
            `This could be due to:\n` +
            `• GitHub API rate limits\n` +
            `• Insufficient token permissions (needs 'repo' scope)\n` +
            `• Network connectivity issues\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
