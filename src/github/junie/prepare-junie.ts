import * as core from "@actions/core";
import {
    JunieExecutionContext,
    isTriggeredByUserInteraction,
    isPushEvent,
    isJiraWorkflowDispatchEvent,
    isResolveConflictsWorkflowDispatchEvent, isWorkflowRunFailureEvent,
    isYouTrackWorkflowDispatchEvent,
} from "../context";
import {checkHumanActor} from "../validation/actor";
import {postJunieWorkingStatusComment} from "../operations/comments/feedback";
import {initializeJunieWorkspace} from "../operations/branch";
import {PrepareJunieOptions} from "./types/junie";
import {configureGitCredentials} from "../operations/auth";
import {prepareMcpConfig} from "../../mcp/prepare-mcp-config";
import {verifyRepositoryAccess} from "../validation/permissions";
import {Octokits} from "../api/client";
import {prepareJunieTask} from "./junie-tasks";
import {prepareJunieCLIToken} from "./junie-token";
import {OUTPUT_VARS} from "../../constants/environment";
import {INIT_COMMENT_BODY, RESOLVE_CONFLICTS_ACTION,} from "../../constants/github";
import {getJiraClient} from "../jira/client";
import {convertMarkdownToADF} from "../jira/markdown-to-jira";
import {getYouTrackClient} from "../youtrack/client";
import {detectJunieTriggerPhrase} from "../validation/trigger";

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

    // Post "started working" comment for Jira-triggered workflows and save the comment ID
    if (isJiraWorkflowDispatchEvent(context)) {
        try {
            const client = getJiraClient();
            const adfComment = convertMarkdownToADF(INIT_COMMENT_BODY);
            const commentId = await client.addComment(context.payload.issueKey, adfComment);
            if (commentId) {
                core.setOutput(OUTPUT_VARS.JIRA_INIT_COMMENT_ID, commentId);
            }
        } catch (jiraError) {
            console.warn('Failed to post starting comment to Jira:', jiraError);
            // Don't fail the workflow if Jira update fails
        }
    }

    // Post "started working" comment for YouTrack-triggered workflows and save the comment ID
    if (isYouTrackWorkflowDispatchEvent(context)) {
        try {
            console.log('Youtrack Payload: ', JSON.stringify(context.payload, null, 2));
            const client = getYouTrackClient(context.payload.youtrackBaseUrl);
            const commentId = await client.addComment(context.payload.issueId, INIT_COMMENT_BODY);
            if (commentId) {
                core.setOutput(OUTPUT_VARS.YOUTRACK_INIT_COMMENT_ID, commentId);
            }
        } catch (ytError) {
            console.warn('Failed to post starting comment to YouTrack:', ytError);
            // Don't fail the workflow if YouTrack update fails
        }
    }

    const branchInfo = await initializeJunieWorkspace(octokit, context);
    const mcpServers = context.inputs.allowedMcpServers ? context.inputs.allowedMcpServers.split(',') : []
    console.log(`MCP Servers enabled by user: ${mcpServers}`)

    // Get PR-specific info for MCP servers
    const prNumber = context.isPR ? context.entityNumber : undefined;
    
    // For workflow_run events, use the workflow run's head_sha (the commit that was tested)
    // This is critical for the checks server to find the correct check runs
    let commitSha = branchInfo.headSha;
    if (isWorkflowRunFailureEvent(context)) {
        const workflowRunSha = (context.payload as any).workflow_run?.head_sha;
        if (workflowRunSha) {
            console.log(`Using workflow_run head_sha for checks: ${workflowRunSha}`);
            commitSha = workflowRunSha;
        }
    }

    // Prepare MCP configuration with automatic server activation
    // - Inline comment server: enabled for PRs (requires commitSha)
    // - Checks server: enabled for fix-ci action or when explicitly requested
    const mcpConfig = await prepareMcpConfig({
        context: context,
        allowedMcpServers: mcpServers,
        githubToken: tokenConfig.workingToken,
        branchInfo: branchInfo,
        prNumber: prNumber,
        commitSha: commitSha,
    })

    await prepareJunieTask(context, branchInfo, octokit, mcpConfig.enabledServers, tokenConfig.isDefaultToken())
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

    if (isYouTrackWorkflowDispatchEvent(context)) {
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

