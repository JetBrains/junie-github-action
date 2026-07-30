import {join} from "node:path";
import {ENV_VARS} from "../constants/environment";

export const JUNIE_OUTPUT_FILE_NAME = 'junie_output.json';

interface KnownJunieError {
    pattern: RegExp;
    explanation: string;
}

/**
 * Known Junie CLI failures that are not related to the task itself.
 * They are matched against the errors reported in the Junie output file
 * to explain the reason instead of showing a raw CLI message only.
 */
const KNOWN_JUNIE_ERRORS: KnownJunieError[] = [
    {
        pattern: /insufficient account balance|tokens on your balance are spent|quota (?:is |has been )?(?:exceeded|exhausted)/i,
        explanation:
            'Junie ran out of AI credits: all tokens on the balance of the account behind `junie_api_key` are spent.\n' +
            'Top up the balance or upgrade the JetBrains AI subscription, or pass your own model API key ' +
            '(for example `anthropic_api_key` / `openai_api_key`), and re-run the workflow.',
    },
    {
        pattern: /unauthorized|invalid token|authentication failed|not authenticated/i,
        explanation:
            'Junie could not authenticate: the `junie_api_key` secret is missing, invalid or expired.\n' +
            'Check the secret in the repository settings and re-run the workflow.',
    },
    {
        pattern: /rate limit/i,
        explanation:
            'Junie hit a rate limit of the AI provider.\n' +
            'Wait a bit and re-run the workflow.',
    },
];

/**
 * Resolves the path to the Junie JSON output file.
 * Falls back to the default file name inside the working directory,
 * because the `Run Junie` step may fail before exporting its output.
 */
export function resolveJunieOutputFile(): string | undefined {
    const fromEnv = process.env[ENV_VARS.JSON_JUNIE_OUTPUT_FILE]?.trim();
    if (fromEnv) {
        return fromEnv;
    }

    const workingDir = process.env[ENV_VARS.WORKING_DIR]?.trim();
    if (workingDir) {
        return join(workingDir, JUNIE_OUTPUT_FILE_NAME);
    }

    return undefined;
}

/**
 * Describes the exit code of the Junie CLI, if it is known and non-zero.
 * Returns an empty string when there is nothing useful to report.
 */
export function formatJunieExitCodeNote(exitCode: string | undefined): string {
    const trimmed = exitCode?.trim();
    if (!trimmed || trimmed === '0') {
        return '';
    }

    return `Junie CLI exited with code ${trimmed}.\n`;
}

/**
 * Builds a human-readable error message from the errors reported by the Junie CLI.
 */
export function formatJunieErrors(errors: string[], exitCode?: string): string {
    const errorList = errors.map(error => `  • ${error}`).join('\n');
    const explanations = KNOWN_JUNIE_ERRORS
        .filter(known => errors.some(error => known.pattern.test(error)))
        .map(known => known.explanation);

    const explanationBlock = explanations.length > 0
        ? `\nWhat it means:\n${explanations.join('\n')}\n`
        : '';

    return `❌ Junie execution failed.\n\n` +
        `Errors reported by Junie:\n${errorList}\n` +
        explanationBlock +
        `\n${formatJunieExitCodeNote(exitCode)}` +
        `Check the Junie execution logs above for more details.`;
}
