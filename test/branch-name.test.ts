import {describe, expect, test} from "bun:test";
import {generateWorkingBranchName} from "../src/github/operations/branch";

describe("generateWorkingBranchName", () => {
    describe("with outputBranch provided", () => {
        test("should prepend junie/ prefix when not already present", () => {
            const result = generateWorkingBranchName("my-feature", false, 42, "12345");
            expect(result).toBe("junie/my-feature");
        });

        test("should not double-prefix when junie/ is already present", () => {
            const result = generateWorkingBranchName("junie/my-feature", false, 42, "12345");
            expect(result).toBe("junie/my-feature");
        });

        test("should use outputBranch regardless of entity type or number", () => {
            const result = generateWorkingBranchName("custom-branch", true, 99, "67890");
            expect(result).toBe("junie/custom-branch");
        });
    });

    describe("without outputBranch (auto-generated)", () => {
        test("should generate issue branch name with entity number", () => {
            const result = generateWorkingBranchName(undefined, false, 42, "12345");
            expect(result).toBe("junie/issue-42-12345");
        });

        test("should generate pr branch name for PR context", () => {
            const result = generateWorkingBranchName(undefined, true, 10, "12345");
            expect(result).toBe("junie/pr-10-12345");
        });

        test("should generate run branch name when no entity number", () => {
            const result = generateWorkingBranchName(undefined, false, undefined, "12345");
            expect(result).toBe("junie/run-12345");
        });
    });
});
