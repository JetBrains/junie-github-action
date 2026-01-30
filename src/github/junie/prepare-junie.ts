import * as core from "@actions/core";
import {
    JunieExecutionContext,
    isTriggeredByUserInteraction,
    isPushEvent,
    isJiraWorkflowDispatchEvent,
    isResolveConflictsWorkflowDispatchEvent, isPullRequestEvent, isPullRequestReviewEvent, isIssueCommentEvent, isWorkflowRunFailureEvent,
} from "../context";
import {checkHumanActor} from "../validation/actor";
import {postJunieWorkingStatusComment} from "../operations/comments/feedback";
import {initializeJunieWorkspace} from "../operations/branch";
import {PrepareJunieOptions} from "./types/junie";
import {detectJunieTriggerPhrase, isReviewOrCommentHasFixCITrigger} from "../validation/trigger";
import {configureGitCredentials} from "../operations/auth";
import {prepareMcpConfig} from "../../mcp/prepare-mcp-config";
import {verifyRepositoryAccess} from "../validation/permissions";
import {Octokits} from "../api/client";
import {prepareJunieTask} from "./junie-tasks";
import {prepareJunieCLIToken} from "./junie-token";
import {OUTPUT_VARS} from "../../constants/environment";
import {RESOLVE_CONFLICTS_ACTION, FIX_CI_ACTION} from "../../constants/github";
import {getJiraClient} from "../jira/client";

/**
 * Initializes Junie execution by preparing environment, auth, and workflow context
 */
export async function initializeJunieExecution({
                                  context,
                                  octokit,
                                  tokenConfig,
                              }: PrepareJunieOptions) {

    const handle = await shouldHandle(context, octokit)

    if (!handle) {
        console.log("No need to run junie")
        core.setOutput(OUTPUT_VARS.SHOULD_SKIP, 'true');
        return;
    }
    core.setOutput(OUTPUT_VARS.SHOULD_SKIP, 'false');

    await prepareJunieCLIToken(context)

    await configureGitCredentials(context, tokenConfig)

    await postJunieWorkingStatusComment(octokit.rest, context);

    // Start Jira issue if this is a Jira-triggered workflow
    if (isJiraWorkflowDispatchEvent(context)) {
        try {
            const client = getJiraClient();
            await client.startIssue(context.payload.issueKey);
        } catch (jiraError) {
            console.warn('Failed to start Jira issue:', jiraError);
            // Don't fail the workflow if Jira update fails
        }
    }

    const branchInfo = await initializeJunieWorkspace(octokit, context);
    const mcpServers = context.inputs.allowedMcpServers ? context.inputs.allowedMcpServers.split(',') : []
    console.log(`MCP Servers enabled by user: ${mcpServers}`)

    // Get PR-specific info for MCP servers
    const prNumber = context.isPR ? context.entityNumber : undefined;
    const commitSha = branchInfo.headSha;

    // Detect if this is a fix-ci action (needed for auto-enabling checks server)
    const isFixCIInPrompt = context.inputs.prompt?.includes(FIX_CI_ACTION);
    const isFixCIInComment = isReviewOrCommentHasFixCITrigger(context);
    const isFixCIFromWorkflowFailure = isWorkflowRunFailureEvent(context);
    const isFixCI = isFixCIInPrompt || isFixCIInComment || isFixCIFromWorkflowFailure;

    // Prepare MCP configuration with automatic server activation
    // - Inline comment server: enabled for PRs (requires commitSha)
    // - Checks server: enabled for fix-ci action or when explicitly requested
    const mcpConfig = await prepareMcpConfig({
        junieWorkingDir: context.inputs.junieWorkingDir,
        allowedMcpServers: mcpServers,
        githubToken: tokenConfig.workingToken,
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        branchInfo: branchInfo,
        prNumber: prNumber,
        commitSha: commitSha,
        isFixCI: isFixCI
    })

    await prepareJunieTask(context, branchInfo, octokit, mcpConfig.enabledServers)
}

async function shouldHandle(context: JunieExecutionContext, octokit: Octokits): Promise<boolean> {
    if (isTriggeredByUserInteraction(context)) {
        const hasWritePermissions = await verifyRepositoryAccess(
            octokit.rest,
            context,
        );
        if (!hasWritePermissions) {
            console.log("No write permissions, skipping junie");
            return false;
        }
    }

    if (context.inputs.prompt) {
        return true;
    }

    if (context.inputs.resolveConflicts) {
        return await shouldResolveConflicts(context, octokit)
    }

    if (isJiraWorkflowDispatchEvent(context)) {
        return true;
    }

    if (isWorkflowRunFailureEvent(context)) {
        return true;
    }

    return isTriggeredByUserInteraction(context) && detectJunieTriggerPhrase(context) && checkHumanActor(octokit.rest, context);
}

async function shouldResolveConflicts(context: JunieExecutionContext, octokit: Octokits): Promise<boolean> {
    console.log('Checking for conflicts...')
    if (isResolveConflictsWorkflowDispatchEvent(context)) {
        return true;
    }

    const {owner, name} =  context.payload.repository
    const prs = []

    if (context.isPR && context.entityNumber) {
        const {data} = await octokit.rest.pulls.get({
            owner: owner.login,
            repo: name,
            pull_number: context.entityNumber,
        })
        prs.push(data)
    } else if (isPushEvent(context)) {
        const branch = context.payload.ref.replace("refs/heads/", "");

        const {data} = await octokit.rest.pulls.list({
            owner: owner.login,
            repo: name,
            base: branch,
            state: "open"
        });

        console.log(`Found ${JSON.stringify(data)} open pull requests for branch ${branch}`)
        for (const pr of data) {
            const {data} = await octokit.rest.pulls.get({
                owner: owner.login,
                repo: name,
                pull_number: pr.number,
            });
            prs.push(data)
        }
    } else {
        return false
    }

    await Promise.all(prs.map(pr => handlePr(context, octokit, pr)))

    return false
}

async function handlePr(context: JunieExecutionContext, octokit: Octokits, pr: any) {
    const maxAttempts = 10
    const delay = 6000
    const {owner, name} = context.payload.repository
    let attempt = 0
    let state = pr.mergeable_state

    while (attempt < maxAttempts) {
        if (!state || state == 'unknown') {
            attempt++
            await new Promise(resolve => setTimeout(resolve, delay))
        } else if (state == 'dirty') {
            await runResolveConflictsWorkflow(octokit, owner.login, name, pr.head.ref, pr.number)
            return
        } else {
            return
        }
        const {data} = await octokit.rest.pulls.get({
            owner: owner.login,
            repo: name,
            pull_number: pr.number,
        });
        state = data.mergeable_state
    }
}

async function runResolveConflictsWorkflow(octokit: Octokits, owner: string, repo: string, branch: string, prNumber: number) {
    const {ENV_VARS} = await import("../../constants/environment");
    const ref = process.env[ENV_VARS.GITHUB_WORKFLOW_REF]!;
    console.log(`Running resolve conflicts workflow for ${owner}/${repo}@${branch} (PR #${prNumber}) wf ref: ${ref}`)
    const refWithoutBranch = ref.split('@')[0];
    const fileName = refWithoutBranch.split('/').pop()!;
    await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: fileName,
        ref: branch,
        inputs: {
            action: RESOLVE_CONFLICTS_ACTION,
            prNumber: String(prNumber)
        }
    });
}

