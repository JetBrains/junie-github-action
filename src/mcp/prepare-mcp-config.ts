import {GITHUB_API_URL} from "../github/api/config";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../constants/environment";
import {mkdir, writeFile} from "fs/promises";
import {join} from "path";
import {homedir} from 'os';
import {BranchInfo} from "../github/operations/branch";
import {isFixCIEvent, isJiraWorkflowDispatchEvent, isYouTrackWorkflowDispatchEvent, JunieExecutionContext} from "../github/context";

type PrepareConfigParams = {
    context: JunieExecutionContext;
    githubToken: string;
    branchInfo: BranchInfo;
    allowedMcpServers: string[];
    prNumber?: number;
    commitSha?: string;
};


export async function prepareMcpConfig(
    params: PrepareConfigParams,
): Promise<{ configPath: string; enabledServers: string[] }> {
    const {
        context,
        githubToken,
        branchInfo,
        allowedMcpServers,
        prNumber,
        commitSha,
    } = params;
    const owner = context.payload.repository.owner.login
    const repo = context.payload.repository.name
    const hasGHCheksServer = allowedMcpServers.some((name) =>
        name == "mcp_github_checks_server"
    );

    const baseMcpConfig: { mcpServers: Record<string, unknown> } = {
        mcpServers: {},
    };

    // Track which servers are actually enabled
    const enabledServers: string[] = [];

    // Automatically enable inline comment server for PRs
    if (prNumber && commitSha) {
        console.log(`Enabling GitHub Inline Comment MCP Server for PR #${prNumber}`);
        baseMcpConfig.mcpServers.github_inline_comment = {
            command: "bun",
            args: [
                "run",
                `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-inline-comment-server.ts`,
            ],
            env: {
                GITHUB_API_URL: GITHUB_API_URL,
                GITHUB_TOKEN: githubToken,
                REPO_OWNER: owner,
                REPO_NAME: repo,
                PR_NUMBER: String(prNumber),
                COMMIT_SHA: commitSha,
            },
        };
        enabledServers.push('mcp_github_inline_comment_server');
    }
    const isFixCI = isFixCIEvent(context);

    // Auto-enable checks server for fix-ci action or when explicitly requested
    if (hasGHCheksServer || isFixCI) {
        console.log(`Enabling GitHub Checks MCP Server${isFixCI ? ' (auto-enabled for fix-ci)' : ''}`);
        // Use commitSha if available (e.g., from workflow_run events), otherwise fall back to branch reference
        const checksRef = commitSha || `heads/${branchInfo.isNewBranch ? branchInfo.baseBranch : branchInfo.workingBranch}`;
        console.log(`GitHub Checks Server using ref: ${checksRef}`);
        baseMcpConfig.mcpServers.github_checks = {
            command: "bun",
            args: [
                "run",
                `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-checks-server.ts`,
            ],
            env: {
                GITHUB_API_URL: GITHUB_API_URL,
                GITHUB_TOKEN: githubToken,
                REPO_OWNER: owner,
                REPO_NAME: repo,
                HEAD_SHA: checksRef,
            },
        };
        enabledServers.push('mcp_github_checks_server');
    }

    // Add Jira MCP server when triggered by a Jira event
    if (isJiraWorkflowDispatchEvent(context)) {
        const jiraUrl = process.env.JIRA_BASE_URL;
        const jiraUsername = process.env.JIRA_EMAIL;
        const jiraApiToken = process.env.JIRA_API_TOKEN;
        if (jiraUrl && jiraUsername && jiraApiToken) {
            console.log(`Enabling Jira MCP Server for ${jiraUrl}`);
            baseMcpConfig.mcpServers.jira = {
                command: "pipx",
                args: ["run", "mcp-atlassian"],
                env: {
                    JIRA_URL: jiraUrl,
                    JIRA_USERNAME: jiraUsername,
                    JIRA_API_TOKEN: jiraApiToken,
                },
            };
            enabledServers.push('jira');
        } else {
            console.warn('Jira MCP Server not enabled: missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN');
        }
    }

    // Add YouTrack MCP server when triggered by a YouTrack event
    if (isYouTrackWorkflowDispatchEvent(context)) {
        console.log(`Enabling YouTrack MCP Server for ${context.payload.youtrackBaseUrl}`);
        baseMcpConfig.mcpServers.youtrack = {
            command: "npx",
            args: [
                "mcp-remote",
                `${context.payload.youtrackBaseUrl}/mcp`,
                "--header",
                "Authorization:${AUTH_HEADER}",
            ],
            env: {
                AUTH_HEADER: `Bearer ${context.payload.youtrackToken}`,
            },
        };
        enabledServers.push('youtrack');
    }

    const configJsonString = JSON.stringify(baseMcpConfig, null, 2);
    core.setOutput(OUTPUT_VARS.EJ_MCP_CONFIG, configJsonString);

    // Create ~/.junie directory if it doesn't exist
    const junieCMPDir = join(homedir(), '.junie', 'mcp');
    await mkdir(junieCMPDir, {recursive: true});

    // Write mcp.json config file to ~/.junie/mcp.json
    const mcpConfigPath = join(junieCMPDir, 'mcp.json');
    await writeFile(mcpConfigPath, configJsonString, 'utf-8');

    console.log(`Enabled MCP servers: ${enabledServers.join(', ')}`);

    return {
        configPath: mcpConfigPath,
        enabledServers,
    };
}
