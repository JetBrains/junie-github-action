import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { checkHumanActor, isAllowedBot } from "../src/github/validation/actor";
import { mockIssueCommentContext } from "./mockContext";
import type { Octokit } from "@octokit/rest";
import type { UserInitiatedEventContext } from "../src/github/context";

describe("Actor Validation", () => {
  let getUserByUsernameSpy: any;
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      users: {
        getByUsername: async () => ({ data: { type: "User" } }),
      },
    } as any;
  });

  afterEach(() => {
    if (getUserByUsernameSpy) {
      getUserByUsernameSpy.mockRestore();
    }
  });

  describe("checkHumanActor", () => {
    test("should return true for human actor (type: User)", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
        data: { type: "User", login: "contributor-user" },
      } as any);

      const result = await checkHumanActor(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);
      expect(result).toBe(true);
      expect(getUserByUsernameSpy).toHaveBeenCalledWith({
        username: "contributor-user",
      });
    });

    test("should return false for bot actor (type: Bot)", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
        data: { type: "Bot", login: "dependabot[bot]" },
      } as any);

      const context = { ...mockIssueCommentContext, actor: "dependabot[bot]" } as UserInitiatedEventContext;

      const result = await checkHumanActor(mockOctokit, context);
      expect(result).toBe(false);
    });

    test("should return false for github-actions bot", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
        data: { type: "Bot", login: "github-actions[bot]" },
      } as any);

      const context = { ...mockIssueCommentContext, actor: "github-actions[bot]" } as UserInitiatedEventContext;

      const result = await checkHumanActor(mockOctokit, context);
      expect(result).toBe(false);
    });

    test("should call GitHub API with correct username", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
        data: { type: "User", login: "alice" },
      } as any);

      const context = { ...mockIssueCommentContext, actor: "alice" } as UserInitiatedEventContext;

      const result = await checkHumanActor(mockOctokit, context);

      expect(result).toBe(true);
      expect(getUserByUsernameSpy).toHaveBeenCalledWith({
        username: "alice",
      });
      expect(getUserByUsernameSpy).toHaveBeenCalledTimes(1);
    });

    test("should return false on API errors", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockRejectedValue(
        new Error("API rate limit exceeded")
      );

      const result = await checkHumanActor(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);
      expect(result).toBe(false);
    });

    test("should return false on 404 user not found", async () => {
      getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockRejectedValue({
        status: 404,
        message: "Not Found",
      });

      const result = await checkHumanActor(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);
      expect(result).toBe(false);
    });

    describe("allowed_bots allow-list", () => {
      const botContext = (actor: string, allowedBots: string) =>
        ({
          ...mockIssueCommentContext,
          actor,
          inputs: { ...mockIssueCommentContext.inputs, allowedBots },
        }) as UserInitiatedEventContext;

      test("should reject bots by default (empty allowed_bots)", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "Bot", login: "evil-app[bot]" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("evil-app[bot]", ""))).toBe(false);
      });

      test("should allow a bot listed in allowed_bots", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "Bot", login: "dependabot[bot]" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("dependabot[bot]", "dependabot[bot]"))).toBe(true);
      });

      test("should allow a bot listed without the [bot] suffix and with different casing", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "Bot", login: "Dependabot[bot]" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("Dependabot[bot]", "renovate, DEPENDABOT"))).toBe(true);
      });

      test("should reject a bot that is not in a non-empty allowed_bots list", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "Bot", login: "evil-app[bot]" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("evil-app[bot]", "dependabot, renovate[bot]"))).toBe(false);
      });

      test("should allow any bot when allowed_bots is '*'", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "Bot", login: "evil-app[bot]" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("evil-app[bot]", "*"))).toBe(true);
      });

      test("should never consult allowed_bots for human users", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "User", login: "alice" },
        } as any);

        expect(await checkHumanActor(mockOctokit, botContext("alice", ""))).toBe(true);
      });

      test("should treat 404 as a GitHub App and honour allowed_bots", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockRejectedValue({
          status: 404,
          message: "Not Found",
        });

        expect(await checkHumanActor(mockOctokit, botContext("my-app[bot]", "my-app"))).toBe(true);
        expect(await checkHumanActor(mockOctokit, botContext("my-app[bot]", "other-app"))).toBe(false);
      });

      test("should not allow bots on non-404 API errors even with '*'", async () => {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockRejectedValue(
          new Error("API rate limit exceeded")
        );

        expect(await checkHumanActor(mockOctokit, botContext("my-app[bot]", "*"))).toBe(false);
      });
    });

    test("should work with different actor names", async () => {
      const actors = ["john-doe", "jane_smith", "user123", "test-user-42"];

      for (const actor of actors) {
        getUserByUsernameSpy = spyOn(mockOctokit.users, "getByUsername").mockResolvedValue({
          data: { type: "User", login: actor },
        } as any);

        const context = { ...mockIssueCommentContext, actor } as UserInitiatedEventContext;
        const result = await checkHumanActor(mockOctokit, context);
        expect(result).toBe(true);

        getUserByUsernameSpy.mockRestore();
      }
    });
  });

  describe("isAllowedBot", () => {
    test("empty or whitespace list allows nobody", () => {
      expect(isAllowedBot("dependabot[bot]", "")).toBe(false);
      expect(isAllowedBot("dependabot[bot]", "   ")).toBe(false);
      expect(isAllowedBot("dependabot[bot]", undefined)).toBe(false);
    });

    test("'*' allows every bot", () => {
      expect(isAllowedBot("dependabot[bot]", "*")).toBe(true);
      expect(isAllowedBot("anything[bot]", " * ")).toBe(true);
    });

    test("matches exact entries, ignoring case, spaces and the optional [bot] suffix", () => {
      expect(isAllowedBot("dependabot[bot]", "dependabot")).toBe(true);
      expect(isAllowedBot("dependabot[bot]", "Dependabot[bot]")).toBe(true);
      expect(isAllowedBot("Renovate[bot]", " dependabot , renovate ")).toBe(true);
      expect(isAllowedBot("github-actions[bot]", "dependabot,,renovate,")).toBe(false);
    });

    test("does not match partial names", () => {
      expect(isAllowedBot("evil-dependabot[bot]", "dependabot")).toBe(false);
      expect(isAllowedBot("dependabot[bot]", "dependabot-preview")).toBe(false);
    });

    test("'*' inside a list is not a wildcard", () => {
      expect(isAllowedBot("evil-app[bot]", "dependabot,*")).toBe(false);
    });
  });
});
