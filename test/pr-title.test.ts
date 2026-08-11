import {describe, expect, test} from "bun:test";
import {PR_TITLE_PREFIX, PR_TITLE_TEMPLATE} from "../src/constants/github";

describe("PR_TITLE_TEMPLATE", () => {
    test("prefixes a plain title", () => {
        expect(PR_TITLE_TEMPLATE("Add export functionality to users module"))
            .toBe("[Junie]: Add export functionality to users module");
    });

    test("always starts with the prefix", () => {
        const titles = [
            "Fix NPE in payment processing",
            "[Junie]: Fix NPE in payment processing",
            "  Fix NPE in payment processing  ",
        ];

        for (const title of titles) {
            expect(PR_TITLE_TEMPLATE(title).startsWith(PR_TITLE_PREFIX)).toBe(true);
        }
    });

    test("does not double the prefix when the agent already added one", () => {
        expect(PR_TITLE_TEMPLATE("[Junie]: Fix NPE in payment processing"))
            .toBe("[Junie]: Fix NPE in payment processing");
    });

    test("collapses a repeated prefix", () => {
        expect(PR_TITLE_TEMPLATE("[Junie]: [Junie]: Fix NPE in payment processing"))
            .toBe("[Junie]: Fix NPE in payment processing");
    });

    test("recognises the prefix regardless of case or spacing", () => {
        expect(PR_TITLE_TEMPLATE("[junie]:Fix NPE in payment processing"))
            .toBe("[Junie]: Fix NPE in payment processing");
    });

    test("trims surrounding whitespace", () => {
        expect(PR_TITLE_TEMPLATE("  Add export functionality  "))
            .toBe("[Junie]: Add export functionality");
    });
});
