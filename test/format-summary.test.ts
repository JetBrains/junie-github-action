import { describe, test, expect } from "bun:test";
import { formatJunieSummary } from "../src/entrypoints/format-summary";

describe("Format Junie Summary", () => {
  test("should format basic summary", () => {
    const output = {
      title: "Task Completed",
      summary: "Successfully implemented the feature. All tests passing.",
    };

    const markdown = formatJunieSummary(output);

    expect(markdown).toContain("## 🤖 Junie Execution Report dsa");
    expect(markdown).toContain("### Task Completed");
    expect(markdown).toContain("Successfully implemented the feature");
    expect(markdown).toContain("All tests passing");
  });

  test("should include action details", () => {
    const output = {
      title: "PR Created",
      summary: "Created pull request with changes",
    };

    const markdown = formatJunieSummary(
      output,
      "CREATE_PR",
      "abc123def456",
      "https://github.com/owner/repo/pull/123",
      "junie/issue-456"
    );

    expect(markdown).toContain("### 📊 Execution Details");
    expect(markdown).toContain("🔀 CREATE_PR");
    expect(markdown).toContain("`junie/issue-456`");
    expect(markdown).toContain("`abc123d`");
    expect(markdown).toContain("[View PR](https://github.com/owner/repo/pull/123)");
  });

  test("should format error messages", () => {
    const output = {
      error: "Failed to compile TypeScript",
      summary: "Compilation error occurred",
    };

    const markdown = formatJunieSummary(output);

    expect(markdown).toContain("### ❌ Error");
    expect(markdown).toContain("Failed to compile TypeScript");
  });

  test("should include duration if available", () => {
    const output = {
      title: "Task Completed",
      duration_ms: 45000,
    };

    const markdown = formatJunieSummary(output);

    expect(markdown).toContain("| Duration | 45.0s |");
  });

  test("should handle minimal output", () => {
    const output = {};

    const markdown = formatJunieSummary(output);

    expect(markdown).toContain("## 🤖 Junie Execution Report");
    expect(markdown).toContain("### 📊 Execution Details");
  });

  test("should use correct emoji for action types", () => {
    const output = { summary: "Test" };

    const commitMarkdown = formatJunieSummary(output, "COMMIT_CHANGES");
    expect(commitMarkdown).toContain("💾 COMMIT_CHANGES");

    const prMarkdown = formatJunieSummary(output, "CREATE_PR");
    expect(prMarkdown).toContain("🔀 CREATE_PR");

    const pushMarkdown = formatJunieSummary(output, "PUSH");
    expect(pushMarkdown).toContain("⬆️ PUSH");

    const commentMarkdown = formatJunieSummary(output, "WRITE_COMMENT");
    expect(commentMarkdown).toContain("💬 WRITE_COMMENT");
  });

  test("should format complete execution report", () => {
    const output = {
      title: "Fix TypeScript compilation errors",
      summary: "Fixed 3 compilation errors in authentication module. All files now compile successfully.",
      duration_ms: 12500,
    };

    const markdown = formatJunieSummary(
      output,
      "COMMIT_CHANGES",
      "1a2b3c4d5e6f7890",
      undefined,
      "junie/issue-789"
    );

    expect(markdown).toContain("## 🤖 Junie Execution Report");
    expect(markdown).toContain("### Fix TypeScript compilation errors");
    expect(markdown).toContain("Fixed 3 compilation errors");
    expect(markdown).toContain("All files now compile successfully");
    expect(markdown).toContain("| Action | 💾 COMMIT_CHANGES |");
    expect(markdown).toContain("| Branch | `junie/issue-789` |");
    expect(markdown).toContain("| Commit | `1a2b3c4` |");
    expect(markdown).toContain("| Duration | 12.5s |");
  });
});
