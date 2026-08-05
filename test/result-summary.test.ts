import {describe, expect, test} from "bun:test";
import {condenseSummary, MAX_SUMMARY_LENGTH} from "../src/utils/result-summary";

describe("condenseSummary", () => {
    test("keeps a summary that is already short", () => {
        const summary = "Fixed the TypeScript syntax error that broke the CI check.\n\n" +
            "- Corrected the malformed statement in the failing sample.";
        expect(condenseSummary(summary)).toBe(summary);
    });

    test("drops pasted compiler help", () => {
        const summary = [
            "This update fixes a TypeScript syntax error that caused the CI check to fail.",
            "tsc: The TypeScript Compiler - Version 7.0.2",
            "",
            "COMMON COMMANDS",
            "",
            "tsc --noEmit",
            "--project, -p",
            "type: boolean",
            "default: false",
            "",
            "Changes:",
            "- Fixed the syntax in the failing sample.",
        ].join("\n");

        const condensed = condenseSummary(summary);

        expect(condensed).toContain("This update fixes a TypeScript syntax error");
        expect(condensed).toContain("- Fixed the syntax in the failing sample.");
        expect(condensed).not.toContain("Version 7.0.2");
        expect(condensed).not.toContain("COMMON COMMANDS");
        expect(condensed).not.toContain("--project");
        expect(condensed).not.toContain("type: boolean");
        // No blank runs left behind by the dropped lines.
        expect(condensed).not.toContain("\n\n\n");
    });

    test("drops code blocks", () => {
        const summary = "Extracted the config parser.\n\n```ts\nconst x = 1;\n```\n\nTests still pass.";
        expect(condenseSummary(summary)).toBe("Extracted the config parser.\n\nTests still pass.");
    });

    test("drops logs and stack frames", () => {
        const summary = [
            "Fixed the flaky auth test.",
            "2024-01-01T00:00:00Z starting run",
            "$ bun test",
            "    at Object.<anonymous> (/repo/test/auth.test.ts:12:5)",
        ].join("\n");

        expect(condenseSummary(summary)).toBe("Fixed the flaky auth test.");
    });

    test("keeps prose that merely mentions a command", () => {
        const summary = "Ran bun test to confirm the fix. The npm scripts were left untouched.";
        expect(condenseSummary(summary)).toBe(summary);
    });

    test("keeps the narrative and the change list when help is pasted between them", () => {
        const summary = [
            "What: This update fixes a TypeScript syntax error that caused the CI check to fail.",
            "By correcting the malformed statement in the failing sample, the Version 7.0.2",
            "tsc: The TypeScript Compiler - Version 7.0.2",
            "",
            "COMMON COMMANDS",
            "",
            "tsc --init",
            "Creates a tsconfig.json with the recommended settings in the working directory.",
            "",
            "--noEmit",
            "Disable emitting files from a compilation.",
            "type: boolean",
            "",
            "Changes:",
            "- [step 1] Fixed the TypeScript syntax in the failing sample.",
        ].join("\n");

        expect(condenseSummary(summary)).toBe(
            "What: This update fixes a TypeScript syntax error that caused the CI check to fail.\n\n" +
            "- [step 1] Fixed the TypeScript syntax in the failing sample."
        );
    });

    test("keeps a summary written as a plain bullet list", () => {
        const summary = "- Added the retry helper.\n- Covered it with a unit test.";
        expect(condenseSummary(summary)).toBe(summary);
    });

    test("keeps at most ten change bullets", () => {
        const summary = "Reworked the parser.\n\n" +
            Array.from({length: 15}, (_, index) => `- change ${index + 1}`).join("\n");
        const condensed = condenseSummary(summary);

        expect(condensed).toContain("- change 10");
        expect(condensed).not.toContain("- change 11");
    });

    test("caps a long summary at a sentence boundary", () => {
        const sentence = "The notification pipeline was normalized so downstream consumers agree. ";
        const condensed = condenseSummary(sentence.repeat(40));

        expect(condensed.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
        expect(condensed.endsWith(".")).toBe(true);
    });

    test("falls back to the original text when everything looks like noise", () => {
        const summary = "--noEmit\ntype: boolean";
        expect(condenseSummary(summary)).toBe(summary);
    });

    test("passes empty input through", () => {
        expect(condenseSummary("")).toBe("");
    });
});
