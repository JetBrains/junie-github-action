import * as core from "@actions/core";
import {GitHubContext, isEntityContext, isPushEvent, isWorkflowDispatchEvent} from "../context";
import {checkHumanActor} from "../validation/actor";
import {writeInitialFeedbackComment} from "../operations/comments/feedback";
import {setupBranch} from "../operations/branch";
import {PrepareJunieOptions} from "./types/junie";
import {checkContainsTrigger} from "../validation/trigger";
import {gitAuth} from "../operations/auth";
import {prepareMcpConfig} from "../../mcp/prepare-mcp-config";
import {checkWritePermissions} from "../validation/permissions";
import {Octokits} from "../api/client";
import {prepareJunieTask} from "./junie-tasks";
import {prepareJunieCLIToken} from "./junie-token";
import {OUTPUT_VARS} from "../../constants/environment";
import {RESOLVE_CONFLICTS_ACTION} from "../../constants/github";


export async function prepare({
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

    await gitAuth(context, tokenConfig)

    await writeInitialFeedbackComment(octokit.rest, context);

    const branchInfo = await setupBranch(octokit, context);
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

async function shouldHandle(context: GitHubContext, octokit: Octokits): Promise<boolean> {
    if (isEntityContext(context)) {
        const hasWritePermissions = await checkWritePermissions(
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

    return isEntityContext(context) && checkContainsTrigger(context) && checkHumanActor(octokit.rest, context);
}


async function shouldResolveConflicts(context: GitHubContext, octokit: Octokits): Promise<boolean> {
    console.log('Checking for conflicts...')
    if (isWorkflowDispatchEvent(context)) {
        return true;
    }

    const {owner, name} = context.payload.repository
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

async function handlePr(context: GitHubContext, octokit: Octokits, pr: any) {
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

