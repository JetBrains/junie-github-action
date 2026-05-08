import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";

const actionYaml = readFileSync("action.yml", "utf-8");

describe("action.yml", () => {
    test("pushes commits created directly on the working branch", () => {
        const pushStep = actionYaml.match(/- name: Push changes[\s\S]*?run: \|/);

        expect(pushStep?.[0]).toContain("steps.junie-run-results.outputs.ACTION_TO_DO == 'COMMIT_CHANGES'");
    });
});