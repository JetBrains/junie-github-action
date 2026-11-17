import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildJunieCliArgs, buildJunieCliEnv, JUNIE_API_KEY_ENV} from "../src/github/operations/feedback/auto-collect/agent";

/**
 * Regression tests for JUNIE-5037: the Junie API key (and BYOK keys) were passed to the CLI as argv
 * flags. Argv is visible to every process on the runner and older CLI builds wrote it verbatim into
 * ~/.junie/logs, which the action uploaded as a workflow artifact readable by anyone with read access.
 */

const FLAGS_SCRIPT = "src/scripts/build-junie-flags.sh";
const REDACT_SCRIPT = "src/scripts/redact-junie-artifacts.sh";

function runScript(script: string, env: Record<string, string>, args: string[] = []) {
    const proc = Bun.spawnSync(["bash", script, ...args], {
        env: {PATH: process.env.PATH, HOME: process.env.HOME, ...env},
        stdout: "pipe",
        stderr: "pipe",
    });
    return {
        exitCode: proc.exitCode,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
    };
}

describe("build-junie-flags.sh", () => {
    const secrets = {
        OPENAI_API_KEY: "sk-openai-secret",
        ANTHROPIC_API_KEY: "sk-ant-secret",
        GROK_API_KEY: "xai-secret",
        OPENROUTER_API_KEY: "sk-or-secret",
        GOOGLE_API_KEY: "AIza-secret",
        JUNIE_API_KEY: "junie-secret",
        CLI_TOKEN: "cli-secret",
    };

    test("never emits API keys as CLI flags, even when the legacy env variables are set", () => {
        const {exitCode, stdout} = runScript(FLAGS_SCRIPT, {...secrets, MODEL: "gpt", CUSTOM_JUNIE_ARGS: ""});

        expect(exitCode).toBe(0);
        expect(stdout).toBe("--model=gpt");
        for (const value of Object.values(secrets)) {
            expect(stdout).not.toContain(value);
        }
        expect(stdout).not.toMatch(/--[a-z]+-api-key|--auth/);
    });

    test("keeps custom args and does not duplicate --model", () => {
        const {stdout} = runScript(FLAGS_SCRIPT, {...secrets, MODEL: "gpt", CUSTOM_JUNIE_ARGS: "--model=claude --foo"});

        expect(stdout).toBe("--model=claude --foo");
    });

    test("prints nothing when there is nothing to pass", () => {
        const {stdout} = runScript(FLAGS_SCRIPT, {...secrets});

        expect(stdout).toBe("");
    });
});

describe("auto-collect agent Junie CLI invocation", () => {
    test("argv never contains the API key", () => {
        const args = buildJunieCliArgs("/tmp/session", "/tmp/session/output.json", "--model=gpt");

        expect(args).toEqual([
            "--cache-dir", "/tmp/session",
            "--output-format", "json",
            "--input-format", "json",
            "--json-output-file", "/tmp/session/output.json",
            "--model=gpt",
        ]);
        expect(args.join(" ")).not.toContain("--auth");
    });

    test("API key is passed to the child process via JUNIE_API_KEY", () => {
        const env = buildJunieCliEnv("junie-secret", {PATH: "/usr/bin", JUNIE_OPENAI_API_KEY: "sk-byok"});

        expect(env[JUNIE_API_KEY_ENV]).toBe("junie-secret");
        expect(env.PATH).toBe("/usr/bin");
        // BYOK keys set on the step env are inherited untouched
        expect(env.JUNIE_OPENAI_API_KEY).toBe("sk-byok");
    });

    test("does not inject JUNIE_API_KEY when no token is configured (BYOK-only run)", () => {
        const env = buildJunieCliEnv(undefined, {JUNIE_API_KEY: "from-step-env"});

        expect(env[JUNIE_API_KEY_ENV]).toBe("from-step-env");
        expect(buildJunieCliEnv("", {})[JUNIE_API_KEY_ENV]).toBeUndefined();
    });
});

describe("redact-junie-artifacts.sh", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "junie-redact-"));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    test("removes exact secret values and well-known credential shapes from all files", () => {
        const logsDir = join(dir, "logs");
        const workDir = join(dir, "work");
        mkdirSync(logsDir);
        mkdirSync(workDir);

        // What Junie CLI <= 3419.x wrote as the first log line (the original JUNIE-5037 report)
        writeFileSync(
            join(logsDir, "log-1.log"),
            "Started Junie 26.9.7 (3110.7) with args: --skip-update-check, --auth=eyJhbGciOiJIUzI1NiJ9.payload.sig, --model=x\n" +
            "env dump: JUNIE_API_KEY=eyJhbGciOiJIUzI1NiJ9.payload.sig GH_TOKEN=ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n" +
            "Authorization: Bearer perm:dXNlcg==.NTYtMA==.abcdefghijklmnop\n" +
            "regular line with $pecial [chars] (unchanged)\n",
        );
        // OpenAI echoes an invalid key back in its error message, which lands in junie_output.json
        writeFileSync(
            join(workDir, "junie_output.json"),
            JSON.stringify({errors: ["OpenAI: Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123"], other: "p@ss+word/with=special"}),
        );

        const {exitCode, stdout} = runScript(
            REDACT_SCRIPT,
            {REDACT_SECRETS: "eyJhbGciOiJIUzI1NiJ9.payload.sig\n\np@ss+word/with=special\n"},
            [logsDir, workDir, join(dir, "does-not-exist")],
        );

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Redaction complete");

        const log = readFileSync(join(logsDir, "log-1.log"), "utf-8");
        expect(log).not.toContain("eyJhbGciOiJIUzI1NiJ9");
        expect(log).not.toContain("ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
        expect(log).not.toContain("perm:dXNlcg==");
        expect(log).toContain("--auth=***REDACTED***");
        expect(log).toContain("JUNIE_API_KEY=***REDACTED***");
        expect(log).toContain("GH_TOKEN=***REDACTED***");
        expect(log).toContain("Bearer ***REDACTED***");
        expect(log).toContain("regular line with $pecial [chars] (unchanged)");

        const output = readFileSync(join(workDir, "junie_output.json"), "utf-8");
        expect(output).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz0123");
        expect(output).not.toContain("p@ss+word/with=special");
        expect(JSON.parse(output)).toEqual({
            errors: ["OpenAI: Incorrect API key provided: ***REDACTED***"],
            other: "***REDACTED***",
        });
    });

    test("expands ~ and succeeds when none of the paths exist", () => {
        const {exitCode, stdout} = runScript(REDACT_SCRIPT, {REDACT_SECRETS: ""}, [
            join(dir, "missing"),
            "~/.junie/definitely-not-there-junie-5037",
        ]);

        expect(exitCode).toBe(0);
        expect(stdout).toContain("No artifact paths to redact");
    });
});
