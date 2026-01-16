import {describe, expect, test} from "bun:test";
import {detectJunieTriggerPhrase, escapeRegExp} from "../src/github/validation/trigger";
import {
    createMockContext,
    mockIssueAssignedContext,
    mockIssueCommentContext,
    mockIssueLabeledContext,
    mockIssueOpenedContext,
    mockPullRequestCommentContext,
    mockPullRequestOpenedContext,
    mockPullRequestReviewCommentContext,
    mockPullRequestReviewContext,
} from "./mockContext";
import type {IssueCommentEvent, IssuesEvent, PullRequestEvent, PullRequestReviewEvent} from "@octokit/webhooks-types";

describe("Trigger Validation", () => {
  describe("escapeRegExp", () => {
    test("should escape special regex characters", () => {
      expect(escapeRegExp("@junie-agent")).toBe("@junie-agent");
      expect(escapeRegExp("$test")).toBe("\\$test");
      expect(escapeRegExp("test.")).toBe("test\\.");
      expect(escapeRegExp("[bot]")).toBe("\\[bot\\]");
      expect(escapeRegExp("(group)")).toBe("\\(group\\)");
      expect(escapeRegExp("a*b+c?")).toBe("a\\*b\\+c\\?");
    });
  });

  describe("detectJunieTriggerPhrase", () => {
    describe("assignee trigger", () => {
      test("should trigger when issue is assigned to trigger user", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "assigned",
          inputs: { assigneeTrigger: "junie-bot" },
          payload: {
            ...mockIssueAssignedContext.payload,
            assignee: { login: "junie-bot" },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should handle @ prefix in trigger user", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "assigned",
          inputs: { assigneeTrigger: "@junie-agent" },
          payload: {
            ...mockIssueAssignedContext.payload,
            assignee: { login: "junie-agent" },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should not trigger when assigned to different user", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "assigned",
          inputs: { assigneeTrigger: "junie-bot" },
          payload: {
            ...mockIssueAssignedContext.payload,
            assignee: { login: "other-user" },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });

      test("should not trigger when assignee is missing", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "assigned",
          inputs: { assigneeTrigger: "junie-bot" },
          payload: {
            ...mockIssueAssignedContext.payload,
            assignee: undefined,
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });
    });

    describe("label trigger", () => {
      test("should trigger when issue is labeled with trigger label", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "labeled",
          inputs: { labelTrigger: "junie" },
          payload: {
            ...mockIssueLabeledContext.payload,
            label: { name: "junie" },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should not trigger when labeled with different label", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "labeled",
          inputs: { labelTrigger: "junie" },
          payload: {
            ...mockIssueLabeledContext.payload,
            label: { name: "bug" },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });

      test("should not trigger when label is missing", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "labeled",
          inputs: { labelTrigger: "junie" },
          payload: {
            ...mockIssueLabeledContext.payload,
            label: undefined,
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });
    });

    describe("trigger phrase in issue", () => {
      test("should trigger when phrase is in issue body", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "@junie-agent please help with this bug",
              title: "Bug report",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should trigger when phrase is in issue title", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "Description here",
              title: "@junie-agent Fix login bug",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should trigger when phrase is at start of text", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "@junie-agent help",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should trigger when phrase is at end of text", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "Please help @junie-agent",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should trigger with punctuation after phrase", () => {
        const testCases = [
          "@junie-agent, can you help?",
          "@junie-agent. Fix this bug",
          "@junie-agent! Please review",
          "@junie-agent? What do you think",
          "@junie-agent; also check this",
          "@junie-agent: review needed",
        ];

        testCases.forEach((body) => {
          const context = createMockContext({
            eventName: "issues",
            eventAction: "opened",
            inputs: { triggerPhrase: "@junie-agent" },
            payload: {
              ...mockIssueOpenedContext.payload,
              issue: {
                ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
                body,
              },
            },
          });

          expect(detectJunieTriggerPhrase(context)).toBe(true);
        });
      });

      test("should not trigger when phrase is part of another word", () => {
        const testCases = [
          "email@junie-agent.com",
          "user@junie-agent-test",
          "contact@junie-agentbot.io",
        ];

        testCases.forEach((body) => {
          const context = createMockContext({
            eventName: "issues",
            eventAction: "opened",
            inputs: { triggerPhrase: "@junie-agent" },
            payload: {
              ...mockIssueOpenedContext.payload,
              issue: {
                ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
                body,
              },
            },
          });

          expect(detectJunieTriggerPhrase(context)).toBe(false);
        });
      });

      test("should not trigger when phrase is missing", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "This is a regular bug report",
              title: "Regular bug",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });

      test("should handle empty body and title", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: "",
              title: "",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });

      test("should handle null body", () => {
        const context = createMockContext({
          eventName: "issues",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueOpenedContext.payload,
            issue: {
              ...(mockIssueOpenedContext.payload as IssuesEvent).issue,
              body: null,
              title: "Test",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });
    });

    describe("trigger phrase in PR", () => {
      test("should trigger when phrase is in PR body", () => {
        const context = createMockContext({
          eventName: "pull_request",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockPullRequestOpenedContext.payload,
            pull_request: {
              ...(mockPullRequestOpenedContext.payload as PullRequestEvent).pull_request,
              body: "@junie-agent please review this PR",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should trigger when phrase is in PR title", () => {
        const context = createMockContext({
          eventName: "pull_request",
          eventAction: "opened",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockPullRequestOpenedContext.payload,
            pull_request: {
                ...(mockPullRequestOpenedContext.payload as PullRequestEvent).pull_request,
              title: "@junie-agent Add new feature",
              body: "Description",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });
    });

    describe("trigger phrase in comments", () => {
      test("should trigger on issue comment", () => {
          expect(detectJunieTriggerPhrase(mockIssueCommentContext)).toBe(true);
      });

      test("should trigger on PR comment", () => {
          expect(detectJunieTriggerPhrase(mockPullRequestCommentContext)).toBe(true);
      });

      test("should trigger on PR review", () => {
          expect(detectJunieTriggerPhrase(mockPullRequestReviewContext)).toBe(true);
      });

      test("should trigger on PR review comment", () => {
          expect(detectJunieTriggerPhrase(mockPullRequestReviewCommentContext)).toBe(true);
      });

      test("should not trigger when comment lacks trigger phrase", () => {
        const context = createMockContext({
          eventName: "issue_comment",
          eventAction: "created",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockIssueCommentContext.payload,
            comment: {
              ...(mockIssueCommentContext.payload as IssueCommentEvent).comment,
              body: "This is a regular comment without the trigger",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(false);
      });
    });

    describe("custom trigger phrases", () => {
      test("should work with custom trigger phrase", () => {
        const context = createMockContext({
          eventName: "issue_comment",
          eventAction: "created",
          inputs: { triggerPhrase: "/ai" },
          payload: {
            ...mockIssueCommentContext.payload,
            comment: {
                ...(mockIssueCommentContext.payload as IssueCommentEvent).comment,
              body: "/ai help with this",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });

      test("should escape special characters in custom trigger", () => {
        const context = createMockContext({
          eventName: "issue_comment",
          eventAction: "created",
          inputs: { triggerPhrase: "$bot" },
          payload: {
            ...mockIssueCommentContext.payload,
            comment: {
              ...(mockIssueCommentContext.payload as IssueCommentEvent).comment,
              body: "$bot please review",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });
    });

    describe("PR review comment with edited action", () => {
      test("should trigger on edited review", () => {
        const context = createMockContext({
          eventName: "pull_request_review",
          eventAction: "edited",
          inputs: { triggerPhrase: "@junie-agent" },
          payload: {
            ...mockPullRequestReviewContext.payload,
            action: "edited",
            review: {
              ...(mockPullRequestReviewContext.payload as PullRequestReviewEvent).review,
              body: "@junie-agent check this again",
            },
          },
        });

        expect(detectJunieTriggerPhrase(context)).toBe(true);
      });
    });
  });
});
