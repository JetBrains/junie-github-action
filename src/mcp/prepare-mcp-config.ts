import {GITHUB_API_URL} from "../github/api/config";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../constants/environment";
import {mkdir, writeFile} from "fs/promises";
import {join} from "path";
import {homedir} from 'os';
import {BranchInfo} from "../github/operations/branch";

type PrepareConfigParams = {
    junieWorkingDir: string;
    githubToken: string;
    owner: string;
    repo: string;
    branchInfo: BranchInfo;
    allowedMcpServers: string[];
    prNumber?: number;
    commitSha?: string;
    isFixCI?: boolean;
};


export async function prepareMcpConfig(
    params: PrepareConfigParams,
): Promise<{ configPath: string; enabledServers: string[] }> {
    const {
        githubToken,
        owner,
        repo,
        branchInfo,
        allowedMcpServers,
        prNumber,
        commitSha,
        isFixCI,
    } = params;

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

    // Auto-enable checks server for fix-ci action or when explicitly requested
    if (hasGHCheksServer || isFixCI) {
        console.log(`Enabling GitHub Checks MCP Server${isFixCI ? ' (auto-enabled for fix-ci)' : ''}`);
        const head = branchInfo.isNewBranch ? branchInfo.baseBranch : branchInfo.workingBranch
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
                HEAD_SHA: `heads/${head}`,
            },
        };
        enabledServers.push('mcp_github_checks_server');
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
