#!/usr/bin/env bun

import * as core from "@actions/core";
import {$} from "bun";
import {
    JunieExecutionContext,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
    isPushEvent,
} from "../context";
import type {Octokits} from "../api/client";
import {OUTPUT_VARS} from "../../constants/environment";
import {WORKING_BRANCH_PREFIX} from "../../constants/github";

export type BranchInfo = {
    baseBranch: string;
    workingBranch: string;
    isNewBranch: boolean;
    prBaseBranch?: string;
    headSha?: string;
    /**
     * SHA of the merge-base commit between the PR base and head branches.
     *
     * When present, diff-based tasks (code-review, fix-ci, minor-fix) use an explicit
     * `git diff <mergeBaseSha> HEAD` instead of the three-dot `git diff origin/<base>...`,
     * which no longer depends on the completeness of the local commit graph.
     */
    mergeBaseSha?: string;
};

/**
 * Describes how much git history to fetch for a set of branches.
 *
 * - `{depth}`       — shallow fetch of the last `depth` commits of each ref.
 * - `{sinceIso}`    — shallow fetch of everything newer than the given ISO timestamp (`--shallow-since`).
 * - `"full"`        — complete history (`--unshallow` when the clone is shallow).
 */
export type HistoryScope =
    | { depth: number }
    | { sinceIso: string }
    | "full";

// Extra commits fetched on top of the estimated distance to the merge-base, to
// tolerate racing commits pushed between the API call and the git fetch.
const DEPTH_SLACK = 5;
// Hard cap on the shallow depth so a pathological estimate can never turn into a
// near-full clone of a huge repository.
const DEPTH_CAP = 2000;

/**
 * Determines if the existing PR branch should be used instead of creating a new one.
 *
 * This logic handles different collaboration scenarios:
 * - PR author making changes to their own PR (always use existing branch)
 * - Bot/App making changes to PR it created (always use existing branch)
 * - External contributor helping with PR (configurable via createNewBranchForPR setting)
 *
 * @param silentMode - Setting to suppress any repository modifications
 * @param createNewBranchForPR - Setting to create new branches for external contributors
 * @param actor - Current user triggering the workflow
 * @param prAuthor - Original author of the pull request
 * @param tokenOwnerLogin - Owner of the token being used (often a bot or app)
 * @param state - Current state of the pull request (e.g., "OPEN", "CLOSED", "MERGED")
 * @returns `true` if existing PR branch should be used, `false` to create new branch
 */
function shouldUseExistingPRBranch(
    silentMode: boolean,
    createNewBranchForPR: boolean,
    actor: string,
    prAuthor: string,
    tokenOwnerLogin: string,
    state: string
): boolean {
    console.log(`Silent mode: ${silentMode}`);
    console.log(`PR author: ${prAuthor}`);
    console.log(`Actor: ${actor}`);
    console.log(`Token owner: ${tokenOwnerLogin}`);
    console.log(`Create new branch setting: ${createNewBranchForPR}`);

    if (state === "CLOSED" || state === "MERGED") {
        console.log(`Create new branch: PR is ${state}`);
        return true;
    }

    if (createNewBranchForPR) {
        console.log(`Create new branch: createNewBranchForPR setting is enabled`);
        return false;
    }

    if (silentMode) {
        console.log(`Using existing branch: silent mode is enabled`);
        return true;
    }

    if (actor === prAuthor) {
        console.log(`Using existing branch: actor is PR author`);
        return true;
    }

    if (prAuthor === tokenOwnerLogin) {
        console.log(`Using existing branch: PR author is token owner`);
        return true;
    }

    console.log(`Creating new branch: none of the conditions matched`);
    return false;
}

/**
 * Creates and checks out a new git branch based on a base branch.
 *
 * Branch name is normalized: lowercased and truncated to 50 characters for safety.
 *
 * @param baseBranch - The base branch to branch from (e.g., "main", "develop")
 * @param branchName - Desired name for the new branch (will be normalized)
 * @param prBaseBranch - The base branch for pull requests (e.g., "main", "develop")
 * @returns Branch information object with base, working branch names and isNewBranch flag
 * @throws {Error} if git operations fail (branch doesn't exist, network issues, etc.)
 */
export function generateWorkingBranchName(
    outputBranch: string | undefined,
    isPR: boolean | undefined,
    entityNumber: number | undefined,
    runId: string
): string {
    if (outputBranch) {
        const normalizedOutputBranch = outputBranch.toLowerCase();
        return normalizedOutputBranch.startsWith(WORKING_BRANCH_PREFIX)
            ? normalizedOutputBranch
            : `${WORKING_BRANCH_PREFIX}${normalizedOutputBranch}`;
    }
    const entityType = isPR ? "pr" : entityNumber ? "issue" : "run";
    return `${WORKING_BRANCH_PREFIX}${entityType}${entityNumber ? `-${entityNumber}` : ""}-${runId}`;
}

export async function createNewBranch(baseBranch: string, branchName: string, prBaseBranch: string | undefined, headSha?: string, mergeBaseSha?: string) {
    // Normalize branch name: lowercase and limit to 50 chars for git compatibility
    const newBranch = branchName.toLowerCase().substring(0, 50);

    try {
        if (await isRemoteTrackingRefLocal(baseBranch)) {
            console.log(`Remote-tracking ref origin/${baseBranch} already present locally; skipping fetch`);
        } else {
            await $`git fetch --no-tags origin ${baseBranch}:refs/remotes/origin/${baseBranch}`;
        }

        console.log(`Checking whether remote branch ${newBranch} already exists`);
        const existingBranchFetch = await $`git fetch --no-tags origin +${newBranch}:refs/remotes/origin/${newBranch}`.nothrow();

        if (existingBranchFetch.exitCode === 0) {
            console.log(`Remote branch ${newBranch} already exists, overwriting it from ${baseBranch}`);
        } else {
            console.log(`Creating new branch ${newBranch} from ${baseBranch}`);
        }

        await $`git checkout --no-track -B ${newBranch} origin/${baseBranch}`;

        console.log(`✓ Successfully checked out branch ${newBranch} from ${baseBranch}`);

        return {
            baseBranch: baseBranch,
            workingBranch: newBranch,
            isNewBranch: true,
            prBaseBranch,
            headSha,
            mergeBaseSha
        };
    } catch (error) {
        console.error(`❌ Failed to create branch "${newBranch}" from "${baseBranch}":`, error);
        throw new Error(
            `❌ Failed to create working branch "${newBranch}" from base branch "${baseBranch}". ` +
            `This could be due to:\n` +
            `• Base branch "${baseBranch}" does not exist in the repository\n` +
            `• Insufficient permissions to fetch from the repository\n` +
            `• Network connectivity issues\n` +
            `• Git authentication problems\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

async function prepareWorkingBranchForJunie(context: JunieExecutionContext, octokit: Octokits): Promise<BranchInfo> {
    let baseBranch = context.inputs.baseBranch || context.payload.repository.default_branch
    let prBaseBranch: string | undefined;
    let headSha: string | undefined;
    let mergeBaseSha: string | undefined;
    const entityNumber = context.entityNumber;
    const isPR = context.isPR;
    const createNewBranchForPR = context.inputs.createNewBranchForPR;
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    if (isPR && entityNumber) {
        let sourceBranch: string
        let state: string;
        let prAuthor: string;
        let headLabel: string | undefined;

        if (isPullRequestEvent(context)
            || isPullRequestReviewEvent(context)
            || isPullRequestReviewCommentEvent(context)) {
            baseBranch = context.payload.pull_request.base.ref;
            sourceBranch = context.payload.pull_request.head.ref;
            state = context.payload.pull_request.state;
            prAuthor = context.payload.pull_request.user.login;
            headSha = context.payload.pull_request.head.sha;
            headLabel = context.payload.pull_request.head.label;
        } else {
            try {
                const data = (await octokit.rest.pulls.get({
                    owner: context.payload.repository.owner.login,
                    repo: context.payload.repository.name,
                    pull_number: entityNumber,
                })).data;
                baseBranch = data.base.ref;
                sourceBranch = data.head.ref
                state = data.state;
                prAuthor = data.user.login;
                headSha = data.head.sha;
                headLabel = data.head.label;
            } catch (error) {
                const repoFullName = `${context.payload.repository.owner.login}/${context.payload.repository.name}`;
                throw new Error(
                    `❌ Failed to fetch PR #${entityNumber} information from ${repoFullName}. ` +
                    `This could be due to:\n` +
                    `• PR #${entityNumber} does not exist\n` +
                    `• Insufficient token permissions (needs 'repo' or 'pull_requests:read' scope)\n` +
                    `• GitHub API rate limits\n` +
                    `Original error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        console.log(`Base branch: ${baseBranch}`);
        console.log(`Target branch: ${sourceBranch}`);

        const useExistingBranch = shouldUseExistingPRBranch(
            context.inputs.silentMode,
            createNewBranchForPR,
            context.actor,
            prAuthor,
            context.tokenOwner.login,
            state
        );

        const headOwner = headLabel?.includes(":") ? headLabel.split(":")[0] : owner;
        const isForkPr = headOwner !== owner;

        mergeBaseSha = await fetchPullRequestHistory(
            octokit,
            owner,
            repo,
            baseBranch,
            sourceBranch,
            headLabel ?? sourceBranch,
            entityNumber,
            isForkPr,
        );

        if (useExistingBranch) {
            try {
                await $`git checkout -B ${sourceBranch} origin/${sourceBranch}`;

                console.log(`✓ Successfully checked out PR branch for PR #${entityNumber}`);

                return {
                    baseBranch: baseBranch,
                    workingBranch: sourceBranch!,
                    isNewBranch: false,
                    headSha: headSha,
                    mergeBaseSha
                };
            } catch (error) {
                throw new Error(
                    `❌ Failed to checkout existing PR branch "${sourceBranch}" for PR #${entityNumber}. ` +
                    `This could be due to:\n` +
                    `• Branch "${sourceBranch}" does not exist or was deleted\n` +
                    `• Insufficient permissions to fetch from the repository\n` +
                    `• Network connectivity issues\n` +
                    `• Git authentication problems\n` +
                    `Original error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        } else {
            console.log(`Creating new branch for PR #${entityNumber} based on ${sourceBranch}`);
            prBaseBranch = baseBranch;
            baseBranch = sourceBranch;
        }
    }

    if (isPushEvent(context)) {
        baseBranch = context.payload.ref.replace("refs/heads/", "");
        console.log(`Push event detected, base branch: ${baseBranch}`);
    }

    if (!context.inputs.silentMode) {
        const branchName = generateWorkingBranchName(context.inputs.outputBranch, isPR, entityNumber, context.runId);

        return await createNewBranch(baseBranch, branchName, prBaseBranch, headSha, mergeBaseSha)
    }

    await $`git checkout -B ${baseBranch} origin/${baseBranch}`;

    return {
        baseBranch: baseBranch,
        workingBranch: baseBranch,
        isNewBranch: false,
        prBaseBranch,
        headSha,
        mergeBaseSha
    }
}

async function isRepoShallow(): Promise<boolean> {
    return await $`test -f .git/shallow`.nothrow().then(r => r.exitCode === 0);
}

async function isCommitLocal(sha: string): Promise<boolean> {
    return await $`git cat-file -e ${`${sha}^{commit}`}`.nothrow().then(r => r.exitCode === 0);
}

async function isRemoteTrackingRefLocal(branch: string): Promise<boolean> {
    return await $`git rev-parse --verify --quiet ${`refs/remotes/origin/${branch}`}`
        .nothrow()
        .then(r => r.exitCode === 0);
}

async function isMergeBaseReachable(baseBranch: string, headBranch: string): Promise<boolean> {
    return await $`git merge-base ${`refs/remotes/origin/${baseBranch}`} ${`refs/remotes/origin/${headBranch}`}`
        .nothrow()
        .then(r => r.exitCode === 0);
}

/**
 * A branch to fetch, resolved to the ref pulled from `origin` and the local
 * remote-tracking name it is stored under (`refs/remotes/origin/<name>`).
 *
 * For same-repo branches `remoteRef` equals the branch name. For a fork PR head
 * the branch does not exist on `origin`, so `remoteRef` points at the pull ref
 * (`refs/pull/<n>/head`) while `name` keeps the branch name used everywhere else.
 */
type RemoteBranch = {
    name: string;
    remoteRef: string;
};

function remoteBranch(name: string): RemoteBranch {
    return {name, remoteRef: name};
}

function branchRefspecs(branches: RemoteBranch[]): string[] {
    const seen = new Set<string>();
    const refspecs: string[] = [];
    for (const {name, remoteRef} of branches) {
        if (seen.has(name)) continue;
        seen.add(name);
        refspecs.push(`+${remoteRef}:refs/remotes/origin/${name}`);
    }
    return refspecs;
}

function describeScope(scope: HistoryScope): string {
    if (scope === "full") return "full";
    if ("depth" in scope) return `depth=${scope.depth}`;
    return `since=${scope.sinceIso}`;
}

/**
 * Ensures the repository has enough git history for the requested branches.
 *
 * GitHub Actions by default clones with shallow history (depth=1), so the amount
 * of history needed for a task must be fetched explicitly.
 *
 * Important: on a complete (non-shallow) clone — e.g. `actions/checkout` with
 * `fetch-depth: 0` — shallow flags such as `--depth`/`--shallow-since` are NOT
 * applied, because they would create `.git/shallow` and truncate the already
 * complete history.
 *
 * @param branches - Branches to fetch into `refs/remotes/origin/*` (see {@link RemoteBranch}).
 * @param scope - How much history to fetch (see {@link HistoryScope}).
 * @throws {Error} if unable to fetch history
 */
export async function ensureBranchHistory(branches: RemoteBranch[], scope: HistoryScope = "full") {
    const names = branches.map(({name}) => name);
    console.log(`Fetching history of [${names.join(", ")}] with scope ${describeScope(scope)}...`);

    try {
        const shallow = await isRepoShallow();
        const refspecs = branchRefspecs(branches);
        const flags: string[] = [];

        if (scope === "full") {
            // Only unshallow when the clone is actually shallow.
            if (shallow) {
                console.log(`Repository is shallow, fetching full history...`);
                flags.push("--unshallow");
            }
        } else if ("depth" in scope) {
            // Skip --depth on a complete clone to avoid truncating existing history.
            if (shallow) flags.push(`--depth=${scope.depth}`);
        } else if ("sinceIso" in scope) {
            if (shallow) flags.push(`--shallow-since=${scope.sinceIso}`);
        }

        await $`git fetch --no-tags origin ${flags} ${refspecs}`;
        console.log(`✓ Successfully fetched history of [${names.join(", ")}]`);
    } catch (error) {
        throw new Error(
            `❌ Failed to fetch history of [${names.join(", ")}]. ` +
            `This could be due to:\n` +
            `• A branch does not exist in the repository\n` +
            `• Network connectivity issues\n` +
            `• Insufficient permissions to fetch from the repository\n` +
            `• Git authentication problems\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

type MergeBaseInfo = {
    sha: string;
    aheadBy: number;
    behindBy: number;
    dateIso?: string;
};

/**
 * Computes the merge-base between the PR base and head via the GitHub compare API.
 *
 * A single `repos.compareCommitsWithBasehead` call returns `merge_base_commit.sha`,
 * its date and the `ahead_by`/`behind_by` counters, which lets us fetch only a
 * PR-sized slice of history instead of the whole repository.
 *
 * @param headRef - Head reference for the compare API; for fork PRs it must be the
 *                  `owner:branch` form, otherwise the API returns 404.
 */
async function computeMergeBase(
    octokit: Octokits,
    owner: string,
    repo: string,
    baseRef: string,
    headRef: string,
): Promise<MergeBaseInfo | undefined> {
    try {
        const basehead = `${baseRef}...${headRef}`;
        const {data} = await octokit.rest.repos.compareCommitsWithBasehead({owner, repo, basehead});
        const commit = data.merge_base_commit;
        return {
            sha: commit.sha,
            aheadBy: data.ahead_by,
            behindBy: data.behind_by,
            dateIso: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? undefined,
        };
    } catch (error) {
        console.warn(
            `⚠️ Failed to compute merge-base via GitHub API for ${baseRef}...${headRef}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        return undefined;
    }
}

/**
 * Fallback ladder used when the estimated shallow fetch did not bring in the
 * merge-base. Each rung fetches progressively more history and stops as soon as a
 * merge-base becomes reachable, ending with a full `--unshallow` as the last resort.
 *
 * @returns a short label describing which rung finally worked (for logging).
 */
async function runFallbackLadder(
    base: RemoteBranch,
    head: RemoteBranch,
    mergeBaseDateIso: string | undefined,
): Promise<string> {
    if (await isMergeBaseReachable(base.name, head.name)) {
        return "already-reachable";
    }

    if (mergeBaseDateIso) {
        // --shallow-since gives a connected slice of both branches from the divergence
        // point; go one day before the merge-base to be safe against clock skew.
        const sinceIso = new Date(new Date(mergeBaseDateIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
        await ensureBranchHistory([base, head], {sinceIso});
        if (await isMergeBaseReachable(base.name, head.name)) {
            return `shallow-since=${sinceIso}`;
        }
    }

    for (const deepenBy of [256, 1024]) {
        console.log(`Deepening history by ${deepenBy} commits...`);
        await $`git fetch --no-tags origin --deepen=${deepenBy} ${branchRefspecs([base, head])}`.nothrow();
        if (await isMergeBaseReachable(base.name, head.name)) {
            return `deepen=${deepenBy}`;
        }
    }

    console.log(`Falling back to a full unshallow fetch...`);
    await ensureBranchHistory([base, head], "full");
    return "unshallow";
}

/**
 * Fetches just enough history to work with a pull request without cloning the whole
 * repository. The cost scales with the size of the PR, not the size or age of the repo.
 *
 * Strategy:
 * - Ask the GitHub API for the merge-base and the ahead/behind counters.
 * - On a shallow clone, fetch a bounded slice (`--depth = max(ahead, behind) + slack`,
 *   capped) of both branches; if the merge-base is still unreachable, walk a fallback
 *   ladder (`--shallow-since` → `--deepen` → `--unshallow`).
 * - On a complete clone, only refresh the refs (never truncate existing history).
 *
 * @param prNumber - PR number, used to fetch the head via the pull ref for fork PRs.
 * @param isForkPr - Whether the head lives in a fork; its branch is not on `origin`.
 * @returns the merge-base SHA when it is available locally, otherwise `undefined`
 *          (callers fall back to the three-dot diff).
 */
async function fetchPullRequestHistory(
    octokit: Octokits,
    owner: string,
    repo: string,
    baseBranch: string,
    sourceBranch: string,
    headRefForCompare: string,
    prNumber: number,
    isForkPr: boolean,
): Promise<string | undefined> {
    const startedAt = Date.now();
    const shallow = await isRepoShallow();
    const mergeBase = await computeMergeBase(octokit, owner, repo, baseBranch, headRefForCompare);

    const base = remoteBranch(baseBranch);
    const head: RemoteBranch = isForkPr
        ? {name: sourceBranch, remoteRef: `refs/pull/${prNumber}/head`}
        : remoteBranch(sourceBranch);
    if (isForkPr) {
        console.log(`Fork PR: fetching head from refs/pull/${prNumber}/head (branch ${sourceBranch} is not on origin).`);
    }

    if (mergeBase) {
        console.log(
            `Merge-base: ${mergeBase.sha} ` +
            `(ahead_by=${mergeBase.aheadBy}, behind_by=${mergeBase.behindBy}, date=${mergeBase.dateIso ?? "unknown"})`
        );
        if (mergeBase.aheadBy === 0) {
            console.log(`PR head is not ahead of base — the diff is empty.`);
        }
    }

    let strategy: string;
    if (!shallow) {
        await ensureBranchHistory([base, head], "full");
        strategy = "complete-clone";
    } else if (mergeBase) {
        const depth = Math.min(Math.max(mergeBase.aheadBy, mergeBase.behindBy) + DEPTH_SLACK, DEPTH_CAP);
        await ensureBranchHistory([base, head], {depth});
        strategy = `depth=${depth}`;
        if (!(await isMergeBaseReachable(base.name, head.name))) {
            console.log(`Merge-base not reachable after ${strategy}; running fallback ladder.`);
            strategy = await runFallbackLadder(base, head, mergeBase.dateIso);
        }
    } else {
        strategy = await runFallbackLadder(base, head, undefined);
    }

    const resolvedSha = mergeBase && (await isCommitLocal(mergeBase.sha)) ? mergeBase.sha : undefined;
    console.log(
        `✓ PR history ready in ${Date.now() - startedAt}ms ` +
        `(strategy=${strategy}, mergeBaseSha=${resolvedSha ?? "n/a"})`
    );
    return resolvedSha;
}

/**
 * Sets up the working branch for Junie to make changes.
 *
 * This is the main entry point for branch management. It handles different scenarios:
 * - Issues: Creates new branch from base (e.g., "junie/issue-123")
 * - PRs: Uses existing PR branch or creates new one based on settings
 * - Push events: Uses the pushed branch as base
 *
 * Sets GitHub Actions outputs: BASE_BRANCH, WORKING_BRANCH, IS_NEW_BRANCH
 *
 * @param octokit - Octokit clients (rest and graphql)
 * @param context - Junie execution(event payload, inputs, etc.)
 * @returns Branch information with base branch, working branch, and isNewBranch flag
 * @throws {Error} if unable to fetch PR information or create/checkout branches
 */
export async function initializeJunieWorkspace(octokit: Octokits, context: JunieExecutionContext) {
    let branchInfo = await prepareWorkingBranchForJunie(context, octokit)

    // Set GitHub Actions outputs for use in subsequent steps
    core.setOutput(OUTPUT_VARS.BASE_BRANCH, branchInfo.baseBranch);
    core.setOutput(OUTPUT_VARS.WORKING_BRANCH, branchInfo.workingBranch);
    core.setOutput(OUTPUT_VARS.IS_NEW_BRANCH, branchInfo.isNewBranch.toString());

    return branchInfo;
}
