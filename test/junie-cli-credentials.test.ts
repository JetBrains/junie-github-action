import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
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
    // Running as root ignores file permissions, so the permission based fail-closed test cannot fail there
    const isRoot = process.getuid?.() === 0;
    let root: string;
    let src: string;
    let stage: string;

    beforeEach(() => {
        // realpath: the script stages files under their physical path (/var -> /private/var on macOS)
        root = realpathSync(mkdtempSync(join(tmpdir(), "junie-redact-")));
        src = join(root, "src");
        stage = join(root, "stage");
        mkdirSync(src);
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    const redact = (paths: string[], secrets = "") => runScript(REDACT_SCRIPT, {REDACT_SECRETS: secrets}, [stage, ...paths]);
    /** Reads the staged (uploaded) copy of a source file */
    const staged = (path: string) => readFileSync(join(stage, path), "utf-8");

    test("removes exact secret values and well-known credential shapes from all files", () => {
        const logsDir = join(src, "logs");
        const workDir = join(src, "work");
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

        const {exitCode, stdout} = redact(
            [logsDir, workDir, join(src, "does-not-exist")],
            "eyJhbGciOiJIUzI1NiJ9.payload.sig\n\np@ss+word/with=special\n",
        );

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Redaction complete");

        const log = staged(join(logsDir, "log-1.log"));
        expect(log).not.toContain("eyJhbGciOiJIUzI1NiJ9");
        expect(log).not.toContain("ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
        expect(log).not.toContain("perm:dXNlcg==");
        expect(log).toContain("--auth=***REDACTED***");
        expect(log).toContain("JUNIE_API_KEY=***REDACTED***");
        expect(log).toContain("GH_TOKEN=***REDACTED***");
        expect(log).toContain("Bearer ***REDACTED***");
        expect(log).toContain("regular line with $pecial [chars] (unchanged)");

        const output = staged(join(workDir, "junie_output.json"));
        expect(output).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz0123");
        expect(output).not.toContain("p@ss+word/with=special");
        expect(JSON.parse(output)).toEqual({
            errors: ["OpenAI: Incorrect API key provided: ***REDACTED***"],
            other: "***REDACTED***",
        });
    });

    test("never modifies the live files, only the staged copy", () => {
        // junie_work_dir is configurable and may be the checkout that is committed after the upload step
        const file = join(src, "config.ts");
        const content = 'export const example = "sk-proj-abcdefghijklmnopqrstuvwxyz0123"; // --auth=live-secret\n';
        writeFileSync(file, content);

        const {exitCode} = redact([src], "live-secret");

        expect(exitCode).toBe(0);
        expect(readFileSync(file, "utf-8")).toBe(content);
        expect(staged(file)).toBe('export const example = "***REDACTED***"; // --auth=***REDACTED***\n');
    });

    test("drops symlinks from the staged copy so the uploader cannot follow them to unredacted files", () => {
        // actions/upload-artifact follows symlinks, while the redaction only rewrites regular files
        const outside = join(root, "outside");
        mkdirSync(outside);
        writeFileSync(join(outside, "mcp.json"), '{"GITHUB_TOKEN":"ghs_FAKE0123456789abcdefghijklmnopqrstuv","x":"live-secret"}');
        writeFileSync(join(src, "regular.log"), "ok\n");
        symlinkSync(join(outside, "mcp.json"), join(src, "linked-file.json"));
        symlinkSync(outside, join(src, "linked-dir"));

        const {exitCode, stdout} = redact([src], "live-secret");

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Dropping symlinks and special files");
        expect(existsSync(join(stage, src, "linked-file.json"))).toBe(false);
        expect(existsSync(join(stage, src, "linked-dir"))).toBe(false);
        expect(staged(join(src, "regular.log"))).toBe("ok\n");
        // the link targets themselves are untouched
        expect(readFileSync(join(outside, "mcp.json"), "utf-8")).toContain("live-secret");
    });

    test("follows a symlinked artifact root itself", () => {
        const real = join(root, "real-work");
        mkdirSync(real);
        writeFileSync(join(real, "junie_output.json"), '{"e":"--auth=live-secret"}');
        const link = join(src, "work-link");
        symlinkSync(real, link);

        const {exitCode} = redact([link]);

        expect(exitCode).toBe(0);
        expect(staged(join(link, "junie_output.json"))).toBe('{"e":"--auth=***REDACTED***"}');
    });

    test("redacts secrets in their JSON-escaped forms", () => {
        // JSON serializers escape quotes/backslashes, optionally "/", and HTML-safe ones (Gson) write "=" as =
        const quoted = 'prefix"sensitive\\token';
        const base64 = "perm:dXNlcg==.c2VjcmV0/dmFsdWU=";
        writeFileSync(
            join(src, "out.json"),
            JSON.stringify({a: quoted, b: base64}) + "\n" +
            '{"gson":"perm:dXNlcg\\u003d\\u003d.c2VjcmV0/dmFsdWU\\u003d","slash":"perm:dXNlcg==.c2VjcmV0\\/dmFsdWU="}\n',
        );

        const {exitCode} = redact([src], `${quoted}\n${base64}`);

        expect(exitCode).toBe(0);
        const [first, second] = staged(join(src, "out.json")).trim().split("\n").map((line) => JSON.parse(line!));
        expect(first).toEqual({a: "***REDACTED***", b: "***REDACTED***"});
        expect(second).toEqual({gson: "***REDACTED***", slash: "***REDACTED***"});
    });

    test("keeps minified JSON valid: shape patterns stop at quotes and delimiters", () => {
        // junie_output.json / session transcripts are single-line JSON; a greedy \S+ used to swallow
        // everything up to the next whitespace, i.e. the rest of the document.
        const sample = {
            cmd: "junie --auth=eyJabc.def.ghi --model=x",
            quoted: '--openai-api-key "sk-x" --auth=\'y\' next',
            headers: {Authorization: "Bearer perm:dXNlcg==.NTYtMA==.abcdefghijklmnop"},
            env: "JUNIE_API_KEY=secretvalue;GH_TOKEN=zzz,tail",
            exported: 'export JUNIE_API_KEY="quoted-secret"',
            text: "no secrets here",
        };
        writeFileSync(join(src, "junie_output.json"), JSON.stringify(sample));
        writeFileSync(join(src, "transcript.jsonl"), JSON.stringify(sample) + "\n" + JSON.stringify({text: "second"}) + "\n");

        const {exitCode} = redact([src]);

        expect(exitCode).toBe(0);
        const output = staged(join(src, "junie_output.json"));
        expect(JSON.parse(output)).toEqual({
            cmd: "junie --auth=***REDACTED*** --model=x",
            quoted: '--openai-api-key "***REDACTED***" --auth=\'***REDACTED***\' next',
            headers: {Authorization: "Bearer ***REDACTED***"},
            env: "JUNIE_API_KEY=***REDACTED***;GH_TOKEN=***REDACTED***,tail",
            exported: 'export JUNIE_API_KEY="***REDACTED***"',
            text: "no secrets here",
        });

        const lines = staged(join(src, "transcript.jsonl")).trim().split("\n");
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]!)).toEqual(JSON.parse(output));
        expect(JSON.parse(lines[1]!)).toEqual({text: "second"});
    });

    test("redacts files larger than 50 MB instead of skipping them", () => {
        const big = join(src, "big.log");
        writeFileSync(big, "a".repeat(51 * 1024 * 1024) + "\n--auth=large-file-secret\n");

        const {exitCode} = redact([src]);

        expect(exitCode).toBe(0);
        const tail = staged(big).slice(-64);
        expect(tail).not.toContain("large-file-secret");
        expect(tail).toContain("--auth=***REDACTED***");
    });

    test("redacts read-only source files (the copy is made writable)", () => {
        const roDir = join(src, "ro");
        mkdirSync(roDir);
        writeFileSync(join(roDir, "log.log"), "--auth=secret\n");
        chmodSync(join(roDir, "log.log"), 0o444);
        chmodSync(roDir, 0o555);

        try {
            const {exitCode} = redact([src]);

            expect(exitCode).toBe(0);
            expect(staged(join(roDir, "log.log"))).toBe("--auth=***REDACTED***\n");
        } finally {
            chmodSync(roDir, 0o755);
        }
    });

    test.skipIf(isRoot)("fails closed and removes the stage when a file cannot be copied", () => {
        const secretFile = join(src, "unreadable.log");
        writeFileSync(secretFile, "--auth=secret\n");
        writeFileSync(join(src, "ok.log"), "--auth=secret\n");
        chmodSync(secretFile, 0o000);

        try {
            const {exitCode} = redact([src]);

            // a non-zero exit makes action.yml skip the upload (steps.redact-artifacts.outcome == 'success' gate)
            expect(exitCode).not.toBe(0);
            expect(existsSync(stage)).toBe(false);
        } finally {
            chmodSync(secretFile, 0o644);
        }
    });

    test("refuses a stage directory inside an artifact path", () => {
        const {exitCode, stderr} = runScript(REDACT_SCRIPT, {REDACT_SECRETS: ""}, [join(src, "stage"), src]);

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("contains the stage directory");
    });

    test("expands ~ and succeeds when none of the paths exist", () => {
        const {exitCode, stdout} = redact([join(src, "missing"), "~/.junie/definitely-not-there-junie-5037"]);

        expect(exitCode).toBe(0);
        expect(stdout).toContain("No artifact paths to redact");
    });
});
