import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import {
  postJunieWorkingStatusComment,
  postJunieCompletionComment,
} from "../src/github/operations/comments/feedback";
import type {FinishFeedbackData} from "../src/github/operations/comments/types";
import {
  mockIssueCommentContext,
  mockPullRequestCommentContext,
  mockPullRequestReviewCommentContext,
} from "./mockContext";
import type { Octokit } from "@octokit/rest";
import type { PullRequestReviewCommentEvent } from "@octokit/webhooks-types";
import * as core from "@actions/core";
import * as clientModule from "../src/github/api/client";
import {JunieExecutionContext} from "../src/github/context";
import {createJunieCommentMarker} from "../src/constants/github";

describe("Comment Feedback Operations", () => {
  let createCommentSpy: any;
  let updateCommentSpy: any;
  let listCommentsSpy: any;
  let listReviewCommentsSpy: any;
  let createReplyForReviewCommentSpy: any;
  let updateReviewCommentSpy: any;
  let setOutputSpy: any;
  let createOctokitSpy: any;
  let mockOctokit: Octokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        issues: {
          createComment: mock(async () => ({ data: { id: 12345 } })),
          updateComment: mock(async () => ({ data: { id: 12345 } })),
          listComments: mock(async () => ({ data: [] })),
        },
        pulls: {
          createReplyForReviewComment: mock(async () => ({ data: { id: 67890 } })),
          updateReviewComment: mock(async () => ({ data: { id: 67890 } })),
          listReviewComments: mock(async () => ({ data: [] })),
          listCommentsForReview: mock(async () => ({ data: [] })),
        },
        reactions: {
          createForIssueComment: mock(async () => ({ data: {} })),
          createForPullRequestReviewComment: mock(async () => ({ data: {} })),
        }
      },
    } as any;

    createCommentSpy = mockOctokit.rest.issues.createComment;
    updateCommentSpy = mockOctokit.rest.issues.updateComment;
    listCommentsSpy = mockOctokit.rest.issues.listComments;
    createReplyForReviewCommentSpy = mockOctokit.rest.pulls.createReplyForReviewComment;
    updateReviewCommentSpy = mockOctokit.rest.pulls.updateReviewComment;
    listReviewCommentsSpy = mockOctokit.rest.pulls.listReviewComments;

    // Mock buildGitHubApiClient to return Octokits structure
    createOctokitSpy = spyOn(clientModule, "buildGitHubApiClient").mockReturnValue({
      rest: mockOctokit,
      graphql: {} as any,
    } as any);

    setOutputSpy = spyOn(core, "setOutput").mockImplementation(() => {});
  });

  afterEach(() => {
    createOctokitSpy.mockRestore();
    setOutputSpy.mockRestore();
  });

  describe("postJunieWorkingStatusComment", () => {
    test("should create comment on issue", async () => {
      const commentId = await postJunieWorkingStatusComment(
        mockOctokit,
        mockIssueCommentContext
      );

      expect(commentId).toBe(12345);
      expect(createCommentSpy).toHaveBeenCalledTimes(1);
      const callArgs = createCommentSpy.mock.calls[0][0];
      expect(callArgs.owner).toBe("test-owner");
      expect(callArgs.repo).toBe("test-repo");
      expect(callArgs.issue_number).toBe(55);
      expect(callArgs.body).toContain("Junie");
      expect(setOutputSpy).toHaveBeenCalledWith("INIT_COMMENT_ID", 12345);
    });

    test("should create comment on PR", async () => {
      const commentId = await postJunieWorkingStatusComment(
        mockOctokit,
        mockPullRequestCommentContext
      );

      expect(commentId).toBe(12345);
      expect(createCommentSpy).toHaveBeenCalledTimes(1);
      const callArgs = createCommentSpy.mock.calls[0][0];
      expect(callArgs.owner).toBe("test-owner");
      expect(callArgs.repo).toBe("test-repo");
      expect(callArgs.issue_number).toBe(100);
      expect(callArgs.body).toContain("Junie");
    });

    test("should create reply for review comment", async () => {
      const commentId = await postJunieWorkingStatusComment(
        mockOctokit,
        mockPullRequestReviewCommentContext
      );

      expect(commentId).toBe(67890);
      expect(createReplyForReviewCommentSpy).toHaveBeenCalledTimes(1);
      const callArgs = createReplyForReviewCommentSpy.mock.calls[0][0];
      expect(callArgs.owner).toBe("test-owner");
      expect(callArgs.repo).toBe("test-repo");
      expect(callArgs.pull_number).toBe(200);
      expect(callArgs.comment_id).toBe(666);
      expect(callArgs.body).toContain("Junie");
    });

    test("should skip creating comment for events without entity number", async () => {
      const context = {
        ...mockIssueCommentContext,
        entityNumber: undefined,
        eventName: "workflow_dispatch" as const,
      } as JunieExecutionContext;

      const commentId = await postJunieWorkingStatusComment(mockOctokit, context);

      expect(commentId).toBeUndefined();
      expect(createCommentSpy).not.toHaveBeenCalled();
    });

    test("should include job run link in comment body", async () => {
      await postJunieWorkingStatusComment(mockOctokit, mockIssueCommentContext);

      expect(createCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(
            /https:\/\/github\.com\/test-owner\/test-repo\/actions\/runs\/1234567890/
          ),
        })
      );
    });

    test("should handle API errors", async () => {
      createCommentSpy.mockRejectedValue(new Error("API Error"));

        expect(
            postJunieWorkingStatusComment(mockOctokit, mockIssueCommentContext)
        ).rejects.toThrow("API Error");
    });

    test("should skip comment creation in silent mode", async () => {
      const silentModeContext = {
        ...mockIssueCommentContext,
        inputs: {
          ...mockIssueCommentContext.inputs,
          silentMode: true,
        },
      } as JunieExecutionContext;

      const commentId = await postJunieWorkingStatusComment(mockOctokit, silentModeContext);

      expect(commentId).toBeUndefined();
      expect(createCommentSpy).not.toHaveBeenCalled();
      expect(setOutputSpy).not.toHaveBeenCalled();
    });

    test("should include Junie marker in comment body", async () => {
      await postJunieWorkingStatusComment(mockOctokit, mockIssueCommentContext);

      const marker = createJunieCommentMarker(mockIssueCommentContext.workflow);
      expect(createCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(marker),
        })
      );
    });

    test("should create new comment when useSingleComment is enabled but no existing comment found", async () => {
      const singleCommentContext = {
        ...mockIssueCommentContext,
        inputs: {
          ...mockIssueCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      // Mock listComments to return no existing Junie comments
      listCommentsSpy.mockResolvedValue({ data: [] });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      expect(commentId).toBe(12345);
      expect(listCommentsSpy).toHaveBeenCalledTimes(1);
      expect(createCommentSpy).toHaveBeenCalledTimes(1);
      expect(updateCommentSpy).not.toHaveBeenCalled();
    });

    test("should update existing comment when useSingleComment is enabled and comment found", async () => {
      const singleCommentContext = {
        ...mockIssueCommentContext,
        inputs: {
          ...mockIssueCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      // Mock listComments to return an existing Junie comment
      listCommentsSpy.mockResolvedValue({
        data: [
          { id: 11111, body: "Some other comment" },
          { id: 99999, body: `${createJunieCommentMarker("Test Workflow")}\nHey, it's Junie by JetBrains! I started working...` },
        ],
      });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      expect(commentId).toBe(99999);
      expect(listCommentsSpy).toHaveBeenCalledTimes(1);
      expect(updateCommentSpy).toHaveBeenCalledTimes(1);
      expect(createCommentSpy).not.toHaveBeenCalled();

      const updateCallArgs = updateCommentSpy.mock.calls[0][0];
      expect(updateCallArgs.comment_id).toBe(99999);
      expect(updateCallArgs.body).toContain(createJunieCommentMarker("Test Workflow"));
    });

    test("should find most recent Junie comment when multiple exist", async () => {
      const singleCommentContext = {
        ...mockIssueCommentContext,
        inputs: {
          ...mockIssueCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      // Mock listComments to return multiple Junie comments
      listCommentsSpy.mockResolvedValue({
        data: [
          { id: 11111, body: `${createJunieCommentMarker("Test Workflow")}\nOld Junie comment` },
          { id: 22222, body: "Non-Junie comment" },
          { id: 33333, body: `${createJunieCommentMarker("Test Workflow")}\nMost recent Junie comment` },
        ],
      });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      // Should use the most recent (last in array) Junie comment
      expect(commentId).toBe(33333);
      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 33333,
        body: expect.stringContaining(createJunieCommentMarker("Test Workflow")),
      });
    });

    test("should update review comment when useSingleComment is enabled for review comments", async () => {
      const singleCommentContext = {
        ...mockPullRequestReviewCommentContext,
        inputs: {
          ...mockPullRequestReviewCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      const parentCommentId = (mockPullRequestReviewCommentContext.payload as PullRequestReviewCommentEvent).comment.id;

      // Mock listReviewComments to return an existing Junie review comment in the same thread
      listReviewCommentsSpy.mockResolvedValue({
        data: [
          { id: 88888, body: `${createJunieCommentMarker("Test Workflow")}\nExisting Junie review comment`, in_reply_to_id: parentCommentId },
        ],
      });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      expect(commentId).toBe(88888);
      expect(listReviewCommentsSpy).toHaveBeenCalledTimes(1);
      expect(updateReviewCommentSpy).toHaveBeenCalledTimes(1);
      expect(createReplyForReviewCommentSpy).not.toHaveBeenCalled();
    });

    test("should search only within specific review comment thread", async () => {
      const singleCommentContext = {
        ...mockPullRequestReviewCommentContext,
        inputs: {
          ...mockPullRequestReviewCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      const parentCommentId = (mockPullRequestReviewCommentContext.payload as PullRequestReviewCommentEvent).comment.id;

      // Mock listReviewComments with comments in different threads
      listReviewCommentsSpy.mockResolvedValue({
        data: [
          // Comment in a different thread - should be ignored
          { id: 11111, body: `${createJunieCommentMarker("Test Workflow")}\nJunie in different thread`, in_reply_to_id: 999 },
          // Comment in our thread - should be found
          { id: 22222, body: `${createJunieCommentMarker("Test Workflow")}\nJunie in our thread`, in_reply_to_id: parentCommentId },
          // Another comment in different thread
          { id: 33333, body: `${createJunieCommentMarker("Test Workflow")}\nAnother Junie`, in_reply_to_id: 888 },
        ],
      });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      // Should find the comment from our thread (22222), not from other threads
      expect(commentId).toBe(22222);
      expect(updateReviewCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 22222,
        body: expect.stringContaining(createJunieCommentMarker("Test Workflow")),
      });
    });

    test("should find parent comment if it has Junie marker", async () => {
      const singleCommentContext = {
        ...mockPullRequestReviewCommentContext,
        inputs: {
          ...mockPullRequestReviewCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      const parentCommentId = (mockPullRequestReviewCommentContext.payload as PullRequestReviewCommentEvent).comment.id;

      // Mock listReviewComments where the parent comment itself has the marker
      listReviewCommentsSpy.mockResolvedValue({
        data: [
          // The parent comment itself has Junie marker
          { id: parentCommentId, body: `${createJunieCommentMarker("Test Workflow")}\nJunie parent comment` },
          // Other comments in different threads
          { id: 77777, body: "Regular comment", in_reply_to_id: 999 },
        ],
      });

      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      // Should find the parent comment itself
      expect(commentId).toBe(parentCommentId);
    });

    test("should gracefully handle errors when searching for existing comments", async () => {
      const singleCommentContext = {
        ...mockIssueCommentContext,
        inputs: {
          ...mockIssueCommentContext.inputs,
          useSingleComment: true,
        },
      } as JunieExecutionContext;

      // Mock listComments to throw an error
      listCommentsSpy.mockRejectedValue(new Error("API Error"));

      // Should fall back to creating a new comment
      const commentId = await postJunieWorkingStatusComment(mockOctokit, singleCommentContext);

      expect(commentId).toBe(12345);
      expect(listCommentsSpy).toHaveBeenCalledTimes(1);
      expect(createCommentSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("postJunieCompletionComment", () => {
    const baseFinishData: Omit<FinishFeedbackData, "isJobFailed" | "successData" | "failureData"> = {
      initCommentId: "12345",
      parsedContext: mockIssueCommentContext,
    };

    test("should update comment with success for COMMIT_CHANGES", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: false,
        successData: {
          actionToDo: "COMMIT_CHANGES",
          commitSHA: "abc123def456",
          junieTitle: "Fixed bug",
          junieSummary: "Applied fix to login function",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("abc123def456"),
      });
    });

    test("should update comment with success for CREATE_PR", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: false,
        successData: {
          actionToDo: "CREATE_PR",
          prLink: "https://github.com/test-owner/test-repo/pull/300",
          junieTitle: "Fixed bug",
          junieSummary: "Created PR with fix",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("https://github.com/test-owner/test-repo/pull/300"),
      });
    });

    test("should update comment with manual PR creation link when no PR link", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: false,
        successData: {
          actionToDo: "CREATE_PR",
          workingBranch: "junie/issue-42",
          baseBranch: "main",
          junieTitle: "Fixed bug",
          junieSummary: "Created branch with fix",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringMatching(
          /compare\/main\.\.\.junie\/issue-42/
        ),
      });
    });

    test("should update comment with success for PUSH", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: false,
        successData: {
          actionToDo: "PUSH",
          junieTitle: "Pushed changes",
          junieSummary: "Unpushed commits have been pushed",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("Pushed changes"),
      });
    });

    test("should update comment with success for WRITE_COMMENT", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: false,
        successData: {
          actionToDo: "WRITE_COMMENT",
          junieTitle: "Analysis complete",
          junieSummary: "Here are my findings...",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("Analysis complete"),
      });
    });

    test("should update comment with failure message", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: true,
        failureData: {
          error: "Junie encountered an error",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("Junie encountered an error"),
      });
    });

    test("should include job link in failure message", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: true,
        failureData: {
          error: "Something went wrong",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringMatching(/actions\/runs\/1234567890/),
      });
    });

    test("should update review comment for review comment context", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        parsedContext: mockPullRequestReviewCommentContext,
        isJobFailed: false,
        successData: {
          actionToDo: "WRITE_COMMENT",
          junieTitle: "Done",
          junieSummary: "Fixed the issue",
        },
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateReviewCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("Done"),
      });
      expect(updateCommentSpy).not.toHaveBeenCalled();
    });

    test("should handle failure without error message", async () => {
      const data: FinishFeedbackData = {
        ...baseFinishData,
        isJobFailed: true,
        failureData: {},
      };

      await postJunieCompletionComment(mockOctokit, data);

      expect(updateCommentSpy).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        comment_id: 12345,
        body: expect.stringContaining("Check job logs for more details"),
      });
    });
  });
});
