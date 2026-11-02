import {afterEach, describe, expect, test} from "bun:test";
import {mkdtemp, readFile, rm} from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {prepareMcpConfig} from "../src/mcp/prepare-mcp-config";
import {BranchInfo} from "../src/github/operations/branch";
import {JunieExecutionContext} from "../src/github/context";
import {CODE_REVIEW_ACTION} from "../src/constants/github";
import {createMockContext} from "./mockContext";

const branchInfo: BranchInfo = {
    baseBranch: "main",
    workingBranch: "feature",
    isNewBranch: false,
} as BranchInfo;

function createContext(prompt: string, junieVersion: string): JunieExecutionContext {
    const context = createMockContext({eventName: "pull_request", isPR: true, entityNumber: 7});
    return {...context, inputs: {...context.inputs, prompt, junieVersion}};
}

describe("prepareMcpConfig inline comment server", () => {
    const configDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(configDirs.splice(0).map(dir => rm(dir, {recursive: true, force: true})));
    });

    async function prepare(context: JunieExecutionContext, prNumber: number | undefined) {
        const configDir = await mkdtemp(join(tmpdir(), "junie-mcp-config-"));
        configDirs.push(configDir);
        const result = await prepareMcpConfig({
            context,
            githubToken: "token",
            branchInfo,
            allowedMcpServers: [],
            prNumber,
            commitSha: "abc123",
            configDir,
        });
        const config = JSON.parse(await readFile(result.configPath, "utf-8"));
        return {enabledServers: result.enabledServers, mcpServers: Object.keys(config.mcpServers)};
    }

    test.each([
        ["3418", true],
        ["3418.9", true],
        ["", true],
        ["not-a-version", true],
        ["3419", false],
        ["3500", false],
        ["latest", false],
    ])("code review with Junie '%s' enables the server: %p", async (junieVersion, enabled) => {
        const result = await prepare(createContext(`Please run ${CODE_REVIEW_ACTION}`, junieVersion), 7);

        expect(result.enabledServers.includes("mcp_github_inline_comment_server")).toBe(enabled);
        expect(result.mcpServers.includes("github_inline_comment")).toBe(enabled);
    });

    test("non-review PR run keeps the server for a remote review capable Junie", async () => {
        const result = await prepare(createContext("Fix the typo", "latest"), 7);

        expect(result.enabledServers).toContain("mcp_github_inline_comment_server");
        expect(result.mcpServers).toContain("github_inline_comment");
    });

    test("run without a PR number does not enable the server", async () => {
        const result = await prepare(createContext(`Please run ${CODE_REVIEW_ACTION}`, "3418"), undefined);

        expect(result.enabledServers).not.toContain("mcp_github_inline_comment_server");
        expect(result.mcpServers).not.toContain("github_inline_comment");
    });
});
