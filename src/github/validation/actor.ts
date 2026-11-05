#!/usr/bin/env bun

import type {Octokit} from "@octokit/rest";
import type {UserInitiatedEventContext} from "../context";

/**
 * Normalizes a bot login for comparison: lower-cases it and strips the optional "[bot]" suffix,
 * so that "Dependabot[bot]", "dependabot[bot]" and "dependabot" are all treated as the same bot.
 */
function normalizeBotName(name: string): string {
    return name.trim().toLowerCase().replace(/\[bot\]$/, "");
}

/**
 * Checks whether a non-human actor is explicitly allowed to trigger Junie.
 *
 * Semantics of `allowedBots` (the `allowed_bots` action input):
 * - empty / whitespace → no bots are allowed (secure default)
 * - `*` → any bot is allowed
 * - comma-separated list → only the listed bots are allowed; matching is case-insensitive
 *   and the "[bot]" suffix is optional (e.g. `dependabot, renovate[bot]`)
 *
 * @param actor - Actor login as reported by GitHub (e.g. "dependabot[bot]")
 * @param allowedBots - Raw value of the `allowed_bots` input
 */
export function isAllowedBot(actor: string, allowedBots: string | undefined): boolean {
    const trimmed = (allowedBots ?? "").trim();
    if (trimmed === "*") {
        return true;
    }
    if (!trimmed) {
        return false;
    }

    const allowedList = trimmed
        .split(",")
        .map(normalizeBotName)
        .filter((bot) => bot.length > 0);

    return allowedList.includes(normalizeBotName(actor));
}

/**
 * Verifies that the workflow was triggered by a human user, or by a bot that is explicitly
 * allow-listed via the `allowed_bots` input.
 *
 * This is the primary defense against two classes of problems:
 * - automation loops where bots trigger workflows that trigger other bots;
 * - unauthorized GitHub Apps (e.g. one installed only on a fork) producing events with a
 *   `<app>[bot]` actor that would otherwise bypass the collaborator permission check
 *   (see JUNIE-5036). Any actor ending with "[bot]" is trusted by `verifyRepositoryAccess`,
 *   so this check MUST run for every user-triggered event, including fixed-`prompt` workflows.
 *
 * Only applies to interactive events (comments, issues, PRs) - automated workflows skip this check.
 *
 * @param octokit - Octokit REST client for GitHub API calls
 * @param githubContext - User-initiated event context containing actor information
 * @returns `true` if the actor is a human user or an allow-listed bot, `false` otherwise
 */
export async function checkHumanActor(
    octokit: Octokit,
    githubContext: UserInitiatedEventContext,
): Promise<boolean> {
    const {actor} = githubContext;
    const allowedBots = githubContext.inputs.allowedBots;

    try {
        // Fetch actor information from GitHub API to determine their type (User, Bot)
        const {data: userData} = await octokit.users.getByUsername({
            username: actor,
        });

        const actorType = userData.type;
        console.log(`Actor type: ${actorType}`);

        // Only "User" type is allowed - reject bots and other non-human actors
        if (actorType !== "User") {
            return handleNonHumanActor(actor, actorType, allowedBots);
        }

        console.log(`✓ Verified human actor: ${actor}`);
        return true;
    } catch (error) {
        // GitHub Apps that do not have a user account return 404 from users.getByUsername.
        // Treat them as bots so that allow-listed apps still work.
        if (isNotFoundError(error)) {
            console.log(`Actor "${actor}" not found as a user, treating as a GitHub App`);
            return handleNonHumanActor(actor, "Bot", allowedBots);
        }

        console.error(
            `❌ Failed to verify actor information for "${actor}". ` +
            `This could be due to: \n` +
            `• GitHub API rate limits\n` +
            `• Insufficient token permissions\n` +
            `• Network connectivity issues\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

function handleNonHumanActor(actor: string, actorType: string, allowedBots: string | undefined): boolean {
    if (isAllowedBot(actor, allowedBots)) {
        console.log(`✓ Actor "${actor}" is a bot explicitly allowed by allowed_bots`);
        return true;
    }

    // Remove "[bot]" suffix for cleaner error message (e.g., "dependabot[bot]" -> "dependabot")
    const botName = normalizeBotName(actor);
    console.error(
        `❌ Workflow initiated by non-human actor: ${botName} (type: ${actorType}). ` +
        `Junie can only be triggered by human users to prevent automation loops and unauthorized access. ` +
        `If this bot should be able to trigger Junie, add it to the 'allowed_bots' input ` +
        `(e.g. allowed_bots: "${botName}") or use "*" to allow all bots. ` +
        `For automated workflows, prefer workflow_dispatch or scheduled events.`
    );
    return false;
}

function isNotFoundError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "status" in error) {
        return (error as {status?: unknown}).status === 404;
    }
    return error instanceof Error && error.message.includes("404");
}
