import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from "bun:test";
import * as core from "@actions/core";
import {shouldHandle} from "../src/github/junie/prepare-junie";
import {createMockContext} from "./mockContext";
import type {Octokits} from "../src/github/api/client";

/**
 * Regression tests for JUNIE-5036: a GitHub App installed only on a fork could push to a PR
 * branch, which produced a `pull_request_target` `synchronize` event with a `<app>[bot]` actor.
 * The `[bot]` suffix bypassed the permission check and a fixed `prompt` short-circuited
 * `shouldHandle` before `checkHumanActor`, so Junie executed attacker-controlled project
 * config (e.g. `.junie/mcp/mcp.json`) on the base repository's runner.
 */
describe("shouldHandle - actor authorization gate", () => {
    let getCollaboratorPermissionLevel: ReturnType<typeof mock>;
    let getByUsername: ReturnType<typeof mock>;
    let octokit: Octokits;
    let consoleErrorSpy: any;
    let consoleLogSpy: any;
    let coreInfoSpy: any;
    let coreWarningSpy: any;

    const forkPrPayload = {
        action: "synchronize",
        pull_request: {
            number: 7,
            title: "Totally legit change",
            body: "",
            html_url: "https://github.com/test-owner/test-repo/pull/7",
            state: "open",
            user: {login: "attacker", type: "User"},
            head: {
                ref: "main",
                sha: "deadbeef",
                repo: {full_name: "attacker/test-repo", fork: true},
            },
            base: {
                ref: "main",
                sha: "cafebabe",
                repo: {full_name: "test-owner/test-repo", fork: false},
            },
        },
        repository: {
            name: "test-repo",
            full_name: "test-owner/test-repo",
            owner: {login: "test-owner", type: "User"},
        },
        sender: {login: "evil-app[bot]", type: "Bot"},
    };

    const makeForkPrContext = (actor: string, inputs: Record<string, unknown>) =>
        createMockContext({
            eventName: "pull_request",
            eventAction: "synchronize",
            actor,
            entityNumber: 7,
            isPR: true,
            inputs: inputs as any,
            payload: forkPrPayload,
        });

    beforeEach(() => {
        getCollaboratorPermissionLevel = mock(async () => ({data: {permission: "none"}}));
        getByUsername = mock(async ({username}: {username: string}) => ({
            data: {
                login: username,
                type: username.endsWith("[bot]") ? "Bot" : "User",
            },
        }));
        octokit = {
            rest: {
                repos: {getCollaboratorPermissionLevel},
                users: {getByUsername},
            },
        } as unknown as Octokits;

        consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
        consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
        coreInfoSpy = spyOn(core, "info").mockImplementation(() => {});
        coreWarningSpy = spyOn(core, "warning").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        coreInfoSpy.mockRestore();
        coreWarningSpy.mockRestore();
    });

    describe("JUNIE-5036: fork PR synchronized by an unknown GitHub App with a fixed prompt", () => {
        test("rejects an unknown [bot] actor even when `prompt` is set", async () => {
            const context = makeForkPrContext("evil-app[bot]", {prompt: "code-review", allowedBots: ""});

            const result = await shouldHandle(context, octokit);

            expect(result).toBe(false);
            expect(getByUsername).toHaveBeenCalledWith({username: "evil-app[bot]"});
        });

        test("rejects an unknown [bot] actor when `allowed_bots` names other bots", async () => {
            const context = makeForkPrContext("evil-app[bot]", {
                prompt: "code-review",
                allowedBots: "dependabot[bot], renovate",
            });

            expect(await shouldHandle(context, octokit)).toBe(false);
        });

        test("rejects a non-human actor without the [bot] suffix (type: Bot)", async () => {
            getByUsername.mockImplementation(async () => ({data: {login: "Copilot", type: "Bot"}}));
            getCollaboratorPermissionLevel.mockImplementation(async () => ({data: {permission: "write"}}));
            const context = makeForkPrContext("Copilot", {prompt: "code-review", allowedBots: ""});

            expect(await shouldHandle(context, octokit)).toBe(false);
        });

        test("allows a [bot] actor that is explicitly allow-listed", async () => {
            const context = makeForkPrContext("evil-app[bot]", {
                prompt: "code-review",
                allowedBots: "evil-app[bot]",
            });

            expect(await shouldHandle(context, octokit)).toBe(true);
        });

        test("allows any bot when `allowed_bots` is `*`", async () => {
            const context = makeForkPrContext("github-actions[bot]", {prompt: "code-review", allowedBots: "*"});

            expect(await shouldHandle(context, octokit)).toBe(true);
        });
    });

    describe("human actors with a fixed prompt", () => {
        test("allows a human collaborator with write access", async () => {
            getCollaboratorPermissionLevel.mockImplementation(async () => ({data: {permission: "write"}}));
            const context = makeForkPrContext("maintainer", {prompt: "code-review", allowedBots: ""});

            expect(await shouldHandle(context, octokit)).toBe(true);
            expect(getCollaboratorPermissionLevel).toHaveBeenCalledWith({
                owner: "test-owner",
                repo: "test-repo",
                username: "maintainer",
            });
            expect(getByUsername).toHaveBeenCalledWith({username: "maintainer"});
        });

        test("rejects a human without write access before consulting the trigger", async () => {
            getCollaboratorPermissionLevel.mockImplementation(async () => ({data: {permission: "read"}}));
            const context = makeForkPrContext("attacker", {prompt: "code-review", allowedBots: ""});

            expect(await shouldHandle(context, octokit)).toBe(false);
            expect(getByUsername).not.toHaveBeenCalled();
        });
    });

    describe("trigger phrase mode (no fixed prompt)", () => {
        test("rejects an unknown [bot] that posts the trigger phrase", async () => {
            const context = createMockContext({
                eventName: "issue_comment",
                eventAction: "created",
                actor: "evil-app[bot]",
                inputs: {prompt: "", allowedBots: ""} as any,
                payload: {
                    action: "created",
                    issue: {number: 1, title: "x", body: "", user: {login: "someone", type: "User"}},
                    comment: {id: 1, body: "@junie-agent do something", user: {login: "evil-app[bot]", type: "Bot"}},
                    repository: forkPrPayload.repository,
                    sender: {login: "evil-app[bot]", type: "Bot"},
                },
            });

            expect(await shouldHandle(context, octokit)).toBe(false);
        });

        test("allows a human collaborator that posts the trigger phrase", async () => {
            getCollaboratorPermissionLevel.mockImplementation(async () => ({data: {permission: "admin"}}));
            const context = createMockContext({
                eventName: "issue_comment",
                eventAction: "created",
                actor: "maintainer",
                inputs: {prompt: "", allowedBots: ""} as any,
                payload: {
                    action: "created",
                    issue: {number: 1, title: "x", body: "", user: {login: "someone", type: "User"}},
                    comment: {id: 1, body: "@junie-agent do something", user: {login: "maintainer", type: "User"}},
                    repository: forkPrPayload.repository,
                    sender: {login: "maintainer", type: "User"},
                },
            });

            expect(await shouldHandle(context, octokit)).toBe(true);
        });
    });

    describe("system-triggered events", () => {
        test("workflow_dispatch with a prompt does not require actor validation", async () => {
            const context = createMockContext({
                eventName: "workflow_dispatch",
                actor: "github-actions[bot]",
                inputs: {prompt: "do the thing", allowedBots: ""} as any,
                payload: {repository: forkPrPayload.repository, inputs: {}},
            });

            expect(await shouldHandle(context, octokit)).toBe(true);
            expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
            expect(getByUsername).not.toHaveBeenCalled();
        });
    });
});
