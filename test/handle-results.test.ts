import {describe, expect, test} from "bun:test";
import {ActionType, determineActionType} from "../src/entrypoints/handle-results";

const defaultParams = {
    silentMode: false,
    skipPr: false,
    isCodeReview: false,
    hasChangedFiles: false,
    hasUnpushedCommits: false,
    isNewBranch: false,
    hasInitComment: false,
    isExternalIntegration: false,
};

describe("determineActionType", () => {
    test("silent mode takes precedence - returns NOTHING", () => {
        const result = determineActionType({
            ...defaultParams,
            silentMode: true,
            hasChangedFiles: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.NOTHING);
    });

    test("silent mode takes precedence over skipPr", () => {
        const result = determineActionType({
            ...defaultParams,
            silentMode: true,
            skipPr: true,
            hasChangedFiles: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.NOTHING);
    });

    test("code review returns WRITE_COMMENT", () => {
        const result = determineActionType({
            ...defaultParams,
            isCodeReview: true,
            hasChangedFiles: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.WRITE_COMMENT);
    });

    test("changes on new branch with skipPr returns COMMIT_AND_PUSH", () => {
        const result = determineActionType({
            ...defaultParams,
            skipPr: true,
            hasChangedFiles: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.COMMIT_AND_PUSH);
    });

    test("unpushed commits on new branch with skipPr returns COMMIT_AND_PUSH", () => {
        const result = determineActionType({
            ...defaultParams,
            skipPr: true,
            hasUnpushedCommits: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.COMMIT_AND_PUSH);
    });

    test("changes on new branch without skipPr returns CREATE_PR", () => {
        const result = determineActionType({
            ...defaultParams,
            hasChangedFiles: true,
            isNewBranch: true,
        });
        expect(result).toBe(ActionType.CREATE_PR);
    });

    test("changes on existing branch returns COMMIT_CHANGES regardless of skipPr", () => {
        const result = determineActionType({
            ...defaultParams,
            skipPr: true,
            hasChangedFiles: true,
            isNewBranch: false,
        });
        expect(result).toBe(ActionType.COMMIT_CHANGES);
    });

    test("unpushed commits on existing branch returns PUSH", () => {
        const result = determineActionType({
            ...defaultParams,
            hasUnpushedCommits: true,
            isNewBranch: false,
        });
        expect(result).toBe(ActionType.PUSH);
    });

    test("no changes with init comment returns WRITE_COMMENT", () => {
        const result = determineActionType({
            ...defaultParams,
            hasInitComment: true,
        });
        expect(result).toBe(ActionType.WRITE_COMMENT);
    });

    test("no changes and no comment returns NOTHING", () => {
        const result = determineActionType(defaultParams);
        expect(result).toBe(ActionType.NOTHING);
    });

    test("skipPr with no changes on new branch returns NOTHING", () => {
        const result = determineActionType({
            ...defaultParams,
            skipPr: true,
            isNewBranch: true,
            hasChangedFiles: false,
            hasUnpushedCommits: false,
        });
        expect(result).toBe(ActionType.NOTHING);
    });
});
