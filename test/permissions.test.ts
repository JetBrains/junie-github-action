import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { verifyRepositoryAccess } from "../src/github/validation/permissions";
import { mockIssueCommentContext } from "./mockContext";
import type { Octokit } from "@octokit/rest";
import * as core from "@actions/core";
import type {UserInitiatedEventContext} from "../src/github/context";

describe("Permission Validation", () => {
  let getCollaboratorPermissionLevelSpy: any;
  let coreInfoSpy: any;
  let coreWarningSpy: any;
  let coreErrorSpy: any;
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getCollaboratorPermissionLevel: async () => ({
          data: { permission: "write" },
        }),
      },
    } as any;

    coreInfoSpy = spyOn(core, "info").mockImplementation(() => {});
    coreWarningSpy = spyOn(core, "warning").mockImplementation(() => {});
    coreErrorSpy = spyOn(core, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (getCollaboratorPermissionLevelSpy) {
      getCollaboratorPermissionLevelSpy.mockRestore();
    }
    coreInfoSpy.mockRestore();
    coreWarningSpy.mockRestore();
    coreErrorSpy.mockRestore();
  });

  describe("verifyRepositoryAccess", () => {
    test("should return true for admin permission", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "admin" },
      } as any);

      const result = await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(result).toBe(true);
      expect(coreInfoSpy).toHaveBeenCalledWith(
        "✓ Actor has write access: admin"
      );
    });

    test("should return true for write permission", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "write" },
      } as any);

      const result = await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(result).toBe(true);
      expect(coreInfoSpy).toHaveBeenCalledWith(
        "✓ Actor has write access: write"
      );
    });

    test("should return false for read permission", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "read" },
      } as any);

      const result = await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(result).toBe(false);
      expect(coreWarningSpy).toHaveBeenCalledWith(
        '❌ Actor "contributor-user" has insufficient permissions: read (requires "write" or "admin" access to test-owner/test-repo)'
      );
    });

    test("should return false for none permission", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "none" },
      } as any);

      const result = await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(result).toBe(false);
      expect(coreWarningSpy).toHaveBeenCalledWith(
        '❌ Actor "contributor-user" has insufficient permissions: none (requires "write" or "admin" access to test-owner/test-repo)'
      );
    });

    test("should bypass permission check for GitHub App bots", async () => {
      const context = {
        ...mockIssueCommentContext,
        actor: "junie-bot[bot]",
      } as UserInitiatedEventContext;

      const result = await verifyRepositoryAccess(mockOctokit, context);

      expect(result).toBe(true);
      expect(coreInfoSpy).toHaveBeenCalledWith("Actor is a GitHub App: junie-bot[bot]");
      // Should not call getCollaboratorPermissionLevel
      expect(getCollaboratorPermissionLevelSpy).not.toHaveBeenCalled();
    });

    test("should call API with correct parameters", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "write" },
      } as any);

      await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(getCollaboratorPermissionLevelSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        username: "contributor-user",
      });
    });

    test("should throw error on API failure", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockRejectedValue(new Error("API Error"));

      expect(
        verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext)
      ).rejects.toThrow(/Failed to check permissions for "contributor-user" on test-owner\/test-repo/);

      expect(coreErrorSpy).toHaveBeenCalled();
    });

    test("should handle network errors", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockRejectedValue(new Error("Network timeout"));

      expect(
        verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext)
      ).rejects.toThrow(/Network timeout/);
    });

    test("should log actor info", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "admin" },
      } as any);

      await verifyRepositoryAccess(mockOctokit, mockIssueCommentContext as UserInitiatedEventContext);

      expect(coreInfoSpy).toHaveBeenCalledWith(
        "Checking permissions for actor: contributor-user"
      );
      expect(coreInfoSpy).toHaveBeenCalledWith(
        "Permission level retrieved: admin"
      );
    });

    test("should work with different repository names", async () => {
      getCollaboratorPermissionLevelSpy = spyOn(
        mockOctokit.repos,
        "getCollaboratorPermissionLevel"
      ).mockResolvedValue({
        data: { permission: "write" },
      } as any);

      const context = {
        ...mockIssueCommentContext,
        payload: {
          ...mockIssueCommentContext.payload,
          repository: {
            ...mockIssueCommentContext.payload.repository,
            owner: { login: "acme-corp" },
            name: "awesome-project",
          },
        },
      } as UserInitiatedEventContext;

      await verifyRepositoryAccess(mockOctokit, context);

      expect(getCollaboratorPermissionLevelSpy).toHaveBeenCalledWith({
        owner: "acme-corp",
        repo: "awesome-project",
        username: "contributor-user",
      });
    });

    test("should recognize various bot naming patterns", async () => {
      const botNames = [
        "dependabot[bot]",
        "github-actions[bot]",
        "renovate[bot]",
        "codecov[bot]",
      ];

      for (const botName of botNames) {
        const context = {
          ...mockIssueCommentContext,
          actor: botName,
        } as UserInitiatedEventContext;

        const result = await verifyRepositoryAccess(mockOctokit, context);
        expect(result).toBe(true);
        expect(coreInfoSpy).toHaveBeenCalledWith(
          `Actor is a GitHub App: ${botName}`
        );

        coreInfoSpy.mockClear();
      }
    });
  });
});
