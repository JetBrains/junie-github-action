import {afterEach, beforeEach, describe, expect, spyOn, test} from "bun:test";
import * as os from "os";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {prepareMcpConfig} from "../src/mcp/prepare-mcp-config";
import {JunieExecutionContext} from "../src/github/context";
import {BranchInfo} from "../src/github/operations/branch";

describe("prepareMcpConfig", () => {
    let homeDir: string;

    beforeEach(() => {
        homeDir = mkdtempSync(join(os.tmpdir(), "junie-mcp-config-"));
        spyOn(os, "homedir").mockReturnValue(homeDir);
    });

    afterEach(() => {
        (os.homedir as any).mockRestore();
        rmSync(homeDir, {recursive: true, force: true});
    });

    const branchInfo: BranchInfo = {baseBranch: "main", workingBranch: "feature", isNewBranch: false};

    const createContext = (prompt: string, junieVersion: string): JunieExecutionContext => ({
        eventName: "pull_request",
        runId: "123",
        actor: "testuser",
        actorEmail: "test@example.com",
        tokenOwner: "user",
        isPR: true,
        entityNumber: 123,
        inputs: {prompt, junieVersion, allowedMcpServers: ""},
        payload: {
            action: "opened",
            pull_request: {number: 123, title: "Test PR"},
            repository: {owner: {login: "owner"}, name: "repo"}
        },
    } as unknown as JunieExecutionContext);

    test.each([
        ["code-review", "latest", false],
        ["code-review", "3419", false],
        ["code-review", "3418", true],
        ["", "latest", true],
    ])("prompt '%s' with Junie '%s' starts the inline comment server: %p", async (prompt, junieVersion, started) => {
        const result = await prepareMcpConfig({
            context: createContext(prompt, junieVersion),
            githubToken: "token",
            branchInfo,
            allowedMcpServers: [],
            prNumber: 123,
            commitSha: "abc123",
        });

        const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
        expect(result.configPath).toBe(join(homeDir, ".junie", "mcp", "mcp.json"));
        expect(result.enabledServers.includes("mcp_github_inline_comment_server")).toBe(started);
        expect("github_inline_comment" in config.mcpServers).toBe(started);
    });
});
