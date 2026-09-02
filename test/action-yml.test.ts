import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";

const actionYaml = readFileSync("action.yml", "utf-8");

describe("action.yml", () => {
    test("pushes commits created directly on the working branch", () => {
        const pushStep = actionYaml.match(/- name: Push changes[\s\S]*?run: \|/);

        expect(pushStep?.[0]).toContain("steps.junie-run-results.outputs.ACTION_TO_DO == 'COMMIT_CHANGES'");
    });

    test("excludes Junie service artifacts before the commit step so they don't leak into commits", () => {
        const excludeStep = actionYaml.match(/- name: Exclude Junie service artifacts from commit[\s\S]*?(?=\n\s{4}- (?:name|uses):)/);

        expect(excludeStep?.[0]).toBeDefined();
        expect(excludeStep?.[0]).toContain("info/exclude");
        expect(excludeStep?.[0]).toContain(".junie/plans/");
        expect(excludeStep?.[0]).toContain(".junie/memory/");

        // The exclude step must run before the commit step.
        const excludeIndex = actionYaml.indexOf("- name: Exclude Junie service artifacts from commit");
        const commitIndex = actionYaml.indexOf("- uses: EndBug/add-and-commit@v9");
        expect(excludeIndex).toBeGreaterThan(-1);
        expect(commitIndex).toBeGreaterThan(-1);
        expect(excludeIndex).toBeLessThan(commitIndex);
    });
});