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

    /**
     * JUNIE-5037: the Junie API key used to be passed as `--auth=<key>` in argv. Older CLI builds
     * logged the full argv to ~/.junie/logs, which was uploaded as a workflow artifact readable by
     * anyone with read access to the repository.
     */
    describe("JUNIE-5037: credentials never reach argv or artifacts", () => {
        const getStep = (name: string) =>
            actionYaml.match(new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n\\s{4}(?:#[^\\n]*\\n\\s{4})*- (?:name|uses):)`))?.[0] ?? "";

        test("Run Junie step passes the API key via JUNIE_API_KEY env, not --auth", () => {
            const runStep = getStep("Run Junie");

            expect(runStep).toContain("JUNIE_API_KEY: ${{ steps.prepare.outputs.EJ_CLI_TOKEN }}");
            expect(runStep).not.toContain("--auth");
            expect(runStep).not.toContain("CLI_TOKEN: ${{");
        });

        test("Run Junie step passes BYOK keys via JUNIE_*_API_KEY env only", () => {
            const runStep = getStep("Run Junie");

            for (const provider of ["OPENAI", "ANTHROPIC", "GROK", "OPENROUTER", "GOOGLE"]) {
                expect(runStep).toContain(`JUNIE_${provider}_API_KEY: \${{ inputs.${provider.toLowerCase()}_api_key }}`);
                // The un-prefixed variables fed the flag builder, which turned them into argv flags
                expect(runStep).not.toMatch(new RegExp(`^\\s+${provider}_API_KEY:`, "m"));
            }
        });

        test("Auto-collect step passes BYOK keys via JUNIE_*_API_KEY env only", () => {
            const step = getStep("Auto-collect code review feedback");

            expect(step).toContain("JUNIE_OPENAI_API_KEY: ${{ inputs.openai_api_key }}");
            expect(step).not.toMatch(/^\s+OPENAI_API_KEY:/m);
        });

        test("no step puts an API key into the Junie CLI argv", () => {
            expect(actionYaml).not.toMatch(/--auth[= ]/);
            expect(actionYaml).not.toMatch(/--[a-z]+-api-key[= ]/);
        });

        test("CLI logs and session transcripts are not uploaded unless upload_junie_logs is enabled", () => {
            const uploadStep = getStep("Upload Junie artifacts");

            expect(uploadStep).toContain("inputs.upload_artifacts == 'true'");
            expect(uploadStep).toContain("${{ inputs.junie_work_dir }}");
            expect(uploadStep).toContain("${{ inputs.upload_junie_logs == 'true' && '~/.junie/logs' || '' }}");
            expect(uploadStep).toContain("${{ inputs.upload_junie_logs == 'true' && '~/.junie/sessions' || '' }}");
            expect(uploadStep).not.toMatch(/^\s+~\/\.junie\/(logs|sessions)\s*$/m);
        });

        test("upload_junie_logs is opt-in and upload_artifacts can be disabled", () => {
            const logsInput = actionYaml.match(/ {2}upload_junie_logs:[\s\S]*?default: "(\w+)"/);
            const artifactsInput = actionYaml.match(/ {2}upload_artifacts:[\s\S]*?default: "(\w+)"/);

            expect(logsInput?.[1]).toBe("false");
            expect(artifactsInput?.[1]).toBe("true");
        });

        test("secrets are redacted from artifacts before they are uploaded", () => {
            const redactStep = getStep("Redact secrets from Junie artifacts");

            expect(redactStep).toContain("src/scripts/redact-junie-artifacts.sh");
            expect(redactStep).toContain("if: always()");
            for (const secret of [
                "inputs.junie_api_key",
                "inputs.openai_api_key",
                "inputs.anthropic_api_key",
                "inputs.grok_api_key",
                "inputs.openrouter_api_key",
                "inputs.google_api_key",
                "inputs.custom_github_token",
                "inputs.jira_api_token",
                "inputs.youtrack_token",
                "steps.prepare.outputs.EJ_AUTH_GITHUB_TOKEN",
                "github.token",
            ]) {
                expect(redactStep).toContain(`\${{ ${secret} }}`);
            }

            const redactIndex = actionYaml.indexOf("- name: Redact secrets from Junie artifacts");
            const uploadIndex = actionYaml.indexOf("- name: Upload Junie artifacts");
            expect(redactIndex).toBeGreaterThan(-1);
            expect(redactIndex).toBeLessThan(uploadIndex);
        });

        test("artifact upload fails closed when redaction did not succeed", () => {
            const redactStep = getStep("Redact secrets from Junie artifacts");
            const uploadStep = getStep("Upload Junie artifacts");

            // `continue-on-error` keeps the job alive, so the upload must be gated on the step outcome
            expect(redactStep).toMatch(/^\s+id: redact-artifacts\s*$/m);
            expect(redactStep).toContain("continue-on-error: true");

            const uploadIf = uploadStep.match(/^\s+if: (.*)$/m)?.[1] ?? "";
            expect(uploadIf).toContain("steps.redact-artifacts.outcome == 'success'");
            expect(uploadIf).toContain("inputs.upload_artifacts == 'true'");

            const skipStep = getStep("Skip artifact upload \\(redaction failed\\)");
            expect(skipStep).toContain("steps.redact-artifacts.outcome == 'failure'");
            expect(skipStep).toContain("::warning::");
        });
    });
});