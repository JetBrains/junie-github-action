import * as core from "@actions/core";
import {
    JunieExecutionContext,
    isTriggeredByUserInteraction,
    isPushEvent,
    isJiraWorkflowDispatchEvent,
    isResolveConflictsWorkflowDispatchEvent,
    isCodeReviewWorkflowDispatchEvent,
    isPullRequestEvent
} from "../context";
import {checkHumanActor} from "../validation/actor";
import {postJunieWorkingStatusComment} from "../operations/comments/feedback";
import {initializeJunieWorkspace} from "../operations/branch";
import {PrepareJunieOptions} from "./types/junie";
import {detectJunieTriggerPhrase} from "../validation/trigger";
import {configureGitCredentials} from "../operations/auth";
import {prepareMcpConfig} from "../../mcp/prepare-mcp-config";
import {verifyRepositoryAccess} from "../validation/permissions";
import {Octokits} from "../api/client";
import {prepareJunieTask} from "./junie-tasks";
import {prepareJunieCLIToken} from "./junie-token";
import {OUTPUT_VARS} from "../../constants/environment";
import {CODE_REVIEW_ACTION, RESOLVE_CONFLICTS_ACTION} from "../../constants/github";
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
    console.log(`MCP Servers: ${mcpServers}`)

    if (mcpServers.length > 0) {
        await prepareMcpConfig({
            junieWorkingDir: context.inputs.junieWorkingDir,
            allowedMcpServers: context.inputs.allowedMcpServers ? context.inputs.allowedMcpServers.split(',') : [],
            githubToken: tokenConfig.workingToken,
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            branchInfo: branchInfo,
        })
    }

    await prepareJunieTask(context, branchInfo, octokit)
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

    // 1. Allow explicit Code Review dispatch (the actual review run)
    if (isCodeReviewWorkflowDispatchEvent(context)) {
        console.log("✓ Code Review dispatch detected, proceeding with review.");
        return true;
    }

    // 2. Automatic PR triggering: redirects to workflow_dispatch
    if (isPullRequestEvent(context) && (context.eventAction === "opened" || context.eventAction === "synchronize")) {
        if (await checkHumanActor(octokit.rest, context)) {
            await runCodeReviewWorkflow(octokit, context);
            console.log("✓ Pull Request event handled. Junie will perform the review in the dispatched workflow run. Skipping this run to avoid duplicate comments.");
        }
        // Always return false for the original PR event to avoid double execution
        return false;
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

    return isTriggeredByUserInteraction(context) && detectJunieTriggerPhrase(context) && checkHumanActor(octokit.rest, context);
}

async function runCodeReviewWorkflow(octokit: Octokits, context: JunieExecutionContext & { payload: any }) {
    const {owner, name} = context.payload.repository;
    const prNumber = context.entityNumber;
    const branch = context.payload.pull_request.head.ref;

    const {ENV_VARS} = await import("../../constants/environment");
    const ref = process.env[ENV_VARS.GITHUB_WORKFLOW_REF]!;
    if (!ref) {
        console.error("GITHUB_WORKFLOW_REF is not defined");
        return;
    }

    const refWithoutBranch = ref.split('@')[0];
    const fileName = refWithoutBranch.split('/').pop()!;

    console.log(`✓ Automatically triggering Code Review dispatch for PR #${prNumber} in workflow ${fileName}`);

    try {
        await octokit.rest.actions.createWorkflowDispatch({
            owner: owner.login,
            repo: name,
            workflow_id: fileName,
            ref: branch,
            inputs: {
                action: CODE_REVIEW_ACTION,
                prNumber: String(prNumber)
            }
        });
        console.log(`✓ Dispatch successful for workflow ${fileName} on branch ${branch}`);
    } catch (error: any) {
        console.error(`Failed to trigger Code Review dispatch for ${fileName}. Ensure 'workflow_dispatch' is defined in your YAML.`, error.message);
    }
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

