import {GITHUB_API_URL} from "../github/api/config";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../constants/environment";
import {mkdir, writeFile} from "fs/promises";
import {join} from "path";
import {homedir} from 'os';

type PrepareConfigParams = {
    junieWorkingDir: string;
    githubToken: string;
    owner: string;
    repo: string;
    currentBranch: string;
    allowedMcpServers: string[];
};


export async function prepareMcpConfig(
    params: PrepareConfigParams,
): Promise<string> {
    const {
        githubToken,
        owner,
        repo,
        currentBranch,
        allowedMcpServers,
    } = params;

    const hasGHCheksServer = allowedMcpServers.some((name) =>
        name == "mcp_github_checks_server"
    );

    const baseMcpConfig: { mcpServers: Record<string, unknown> } = {
        mcpServers: {},
    };


    if (hasGHCheksServer) {
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
                HEAD_SHA: currentBranch,
            },
        };
    }

    const configJsonString = JSON.stringify(baseMcpConfig, null, 2);
    core.setOutput(OUTPUT_VARS.EJ_MCP_CONFIG, configJsonString);

    // Create ~/.junie directory if it doesn't exist
    const junieCMPDir = join(homedir(),'.junie', 'mcp');
    await mkdir(junieCMPDir, {recursive: true});

    // Write mcp.json config file to ~/.junie/mcp.json
    const mcpConfigPath = join(junieCMPDir, 'mcp.json');
    await writeFile(mcpConfigPath, configJsonString, 'utf-8');

    return configJsonString;
}
