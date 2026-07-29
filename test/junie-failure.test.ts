import {afterEach, describe, expect, test} from "bun:test";
import {
    formatJunieErrors,
    formatJunieExitCodeNote,
    JUNIE_OUTPUT_FILE_NAME,
    resolveJunieOutputFile
} from "../src/utils/junie-failure";

const envKeys = ["JSON_JUNIE_OUTPUT_FILE", "WORKING_DIR"] as const;

afterEach(() => {
    for (const key of envKeys) {
        delete process.env[key];
    }
});

describe("resolveJunieOutputFile", () => {
    test("uses the exported output file path", () => {
        process.env.JSON_JUNIE_OUTPUT_FILE = "/tmp/work/junie_output.json";
        expect(resolveJunieOutputFile()).toBe("/tmp/work/junie_output.json");
    });

    test("falls back to the working directory when the path is not exported", () => {
        process.env.WORKING_DIR = "/tmp/work";
        expect(resolveJunieOutputFile()).toBe(`/tmp/work/${JUNIE_OUTPUT_FILE_NAME}`);
    });

    test("ignores blank output file path", () => {
        process.env.JSON_JUNIE_OUTPUT_FILE = "   ";
        process.env.WORKING_DIR = "/tmp/work";
        expect(resolveJunieOutputFile()).toBe(`/tmp/work/${JUNIE_OUTPUT_FILE_NAME}`);
    });

    test("returns undefined when nothing is known", () => {
        expect(resolveJunieOutputFile()).toBeUndefined();
    });
});

describe("formatJunieExitCodeNote", () => {
    test("mentions non-zero exit code", () => {
        expect(formatJunieExitCodeNote("1")).toContain("exited with code 1");
    });

    test("is empty for successful and unknown exit codes", () => {
        expect(formatJunieExitCodeNote("0")).toBe("");
        expect(formatJunieExitCodeNote(undefined)).toBe("");
        expect(formatJunieExitCodeNote("")).toBe("");
    });
});

describe("formatJunieErrors", () => {
    test("explains a spent token balance", () => {
        const message = formatJunieErrors(
            ["Junie: Insufficient Account Balance. All tokens on your balance are spent."],
            "1"
        );

        expect(message).toContain("Insufficient Account Balance");
        expect(message).toContain("ran out of AI credits");
        expect(message).toContain("exited with code 1");
        expect(message).not.toContain("output file path is not set");
    });

    test("explains authentication problems", () => {
        const message = formatJunieErrors(["Unauthorized"], "1");
        expect(message).toContain("could not authenticate");
    });

    test("reports unknown errors as is", () => {
        const message = formatJunieErrors(["Something went really wrong"]);

        expect(message).toContain("• Something went really wrong");
        expect(message).not.toContain("What it means:");
    });
});
