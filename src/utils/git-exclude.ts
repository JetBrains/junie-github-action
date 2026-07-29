import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Patterns of plan files that Junie may create while working on a task.
 * They should never end up in the resulting commit unless explicitly requested.
 */
export const PLAN_FILE_PATTERNS = [
    '.junie/',
    'task-plan.md',
    'plan.md',
    '*-plan.md'
];

/**
 * Patterns of generated/temporary artifacts that may appear as a side effect
 * of running or verifying the code (compilation caches, dependencies, etc.).
 * The commit step of the action uses `git add -A`, so without excluding them
 * such files pollute the resulting PR.
 */
export const GENERATED_ARTIFACT_PATTERNS = [
    // Python
    '__pycache__/',
    '*.py[cod]',
    '.pytest_cache/',
    '.mypy_cache/',
    '.ruff_cache/',
    '.tox/',
    '.coverage',
    'htmlcov/',
    '*.egg-info/',
    '.venv/',
    'venv/',
    // JS / TS
    'node_modules/',
    '.next/',
    '.turbo/',
    '.parcel-cache/',
    'npm-debug.log*',
    'yarn-error.log*',
    // JVM
    '*.class',
    '.gradle/',
    'build/',
    'target/',
    'out/',
    // Misc
    '.DS_Store'
];

/**
 * Whether the code is executed by a GitHub Actions runner.
 * Used to avoid touching the local repository of a developer (or of the test run).
 */
export function isRunningInGitHubActions(): boolean {
    return process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Appends the given patterns to `.git/info/exclude` of the repository.
 *
 * `.git/info/exclude` is a local (never committed) counterpart of `.gitignore`,
 * so excluded untracked files are invisible for `git add -A` used by the commit step.
 * Already tracked files are not affected.
 *
 * The operation is idempotent: patterns that are already present are skipped.
 */
export function addGitExcludePatterns(patterns: string[], cwd: string = process.cwd()): void {
    try {
        const gitDir = path.join(cwd, '.git');
        if (!fs.existsSync(gitDir)) {
            return;
        }

        const infoDir = path.join(gitDir, 'info');
        const excludeFile = path.join(infoDir, 'exclude');

        fs.mkdirSync(infoDir, {recursive: true});

        const existingContent = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
        const existingPatterns = new Set(existingContent.split('\n').map(line => line.trim()));

        const missingPatterns = patterns.filter(pattern => !existingPatterns.has(pattern));
        if (missingPatterns.length === 0) {
            return;
        }

        const separator = existingContent.length > 0 && !existingContent.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(excludeFile, `${separator}${missingPatterns.join('\n')}\n`);

        console.log(`Added patterns to .git/info/exclude: ${missingPatterns.join(', ')}`);
    } catch (e) {
        console.warn('Failed to update .git/info/exclude:', e);
    }
}
