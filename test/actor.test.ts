import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { checkHumanActor } from "../src/github/validation/actor";
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
});
