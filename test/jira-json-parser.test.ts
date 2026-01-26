import {describe, test, expect} from "bun:test";
import {safeParseJiraJson, JiraComment, JiraAttachment} from "../src/github/context";

describe("Jira JSON Parser", () => {
    describe("Valid JSON parsing", () => {
        test("parses valid comment JSON", () => {
            const input = '[{"author":"John Doe","body":"Simple comment","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].author).toBe("John Doe");
            expect(result[0].body).toBe("Simple comment");
        });

        test("parses valid attachments JSON", () => {
            const input = '[{"filename":"test.png","mimeType":"image/png","size":1024,"content":"https://example.com/file"}]';
            const result = safeParseJiraJson<JiraAttachment[]>(input, 'issue_attachments');

            expect(result).toHaveLength(1);
            expect(result[0].filename).toBe("test.png");
            expect(result[0].size).toBe(1024);
        });

        test("parses empty array", () => {
            const input = '[]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(0);
        });
    });

    describe("Sanitization of unescaped newlines", () => {
        test("handles literal \\n in comment body", () => {
            // This is what Jira sends when .jsonEncode doesn't work properly
            const input = '[{"author":"John Doe","body":"Line 1\\nLine 2","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("Line 1");
            expect(result[0].body).toContain("Line 2");
        });

        test("handles multiple \\n in comment body", () => {
            const input = '[{"author":"John Doe","body":"@junie Make a plan\\n\\nPlease write details","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("@junie Make a plan");
            expect(result[0].body).toContain("Please write details");
        });

        test("handles actual newline characters", () => {
            const input = '[{"author":"John Doe","body":"Line 1\nLine 2","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("Line 1");
        });

        test("handles literal \\r characters", () => {
            const input = '[{"author":"John Doe","body":"Line 1\\rLine 2","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("Line 1");
            expect(result[0].body).toContain("Line 2");
        });
    });

    describe("Sanitization of unescaped quotes", () => {
        test("handles unescaped quotes in comment body", () => {
            const input = '[{"author":"John Doe","body":"He said \\"hello\\"","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("hello");
        });
    });

    describe("Real-world Jira payloads", () => {
        test("handles complex comment from issue #51", () => {
            // Real payload from issue #51
            const input = '[{"author":"Nikolaos Atlas","body":"@junie Make a plan for this ticket\\n\\nPlease make sure you write a Jira comment explaining your plan in details","created":"2026-01-25T11:25:58.3+0000"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].author).toBe("Nikolaos Atlas");
            expect(result[0].body).toContain("@junie Make a plan");
            expect(result[0].body).toContain("explaining your plan");
        });

        test("handles long multiline comment from issue #51", () => {
            const input = '[{"author":"Nikolaos Atlas","body":"Junie successfully finished!\\n\\nResult: Enable Opening Links in New Tab\\n\\n# *Sidebar Navigation Refactoring:* Updating components\\n# *User Profile Popover Refactoring:* Updating buttons","created":"2026-01-25T12:08:13.2+0000"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("Junie successfully finished");
            expect(result[0].body).toContain("Sidebar Navigation Refactoring");
            expect(result[0].body).toContain("User Profile Popover Refactoring");
        });

        test("handles multiple comments with newlines", () => {
            const input = '[{"author":"User 1","body":"First comment\\nwith newline","created":"2026-01-25T10:00:00Z"},{"author":"User 2","body":"Second\\n\\ncomment","created":"2026-01-25T11:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(2);
            expect(result[0].body).toContain("First comment");
            expect(result[1].body).toContain("Second");
        });
    });

    describe("Edge cases", () => {
        test("handles empty string", () => {
            expect(() => {
                safeParseJiraJson('', 'issue_comments');
            }).toThrow();
        });

        test("throws error for completely invalid JSON", () => {
            expect(() => {
                safeParseJiraJson('not json at all', 'issue_comments');
            }).toThrow();
        });

        test("provides helpful error message on failure", () => {
            try {
                safeParseJiraJson('{invalid', 'issue_comments');
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error.message).toContain('issue_comments');
                expect(error.message).toContain('Jira');
            }
        });
    });

    describe("Special characters", () => {
        test("handles markdown formatting in comments", () => {
            const input = '[{"author":"John","body":"**Bold** and *italic* text\\nWith newline","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("**Bold**");
            expect(result[0].body).toContain("*italic*");
        });

        test("handles special characters in author names", () => {
            const input = '[{"author":"O\'Brien, John","body":"Simple comment","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].author).toContain("O'Brien");
        });

        test("handles URLs in comments", () => {
            const input = '[{"author":"John","body":"Check https://example.com\\nAnd this link too","created":"2026-01-26T10:00:00Z"}]';
            const result = safeParseJiraJson<JiraComment[]>(input, 'issue_comments');

            expect(result).toHaveLength(1);
            expect(result[0].body).toContain("https://example.com");
        });
    });
});
