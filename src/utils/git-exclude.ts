import {execSync} from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Agent scratch files written into the checkout; must never be committed.
export const AGENT_ARTIFACT_PATTERNS = [
    ".junie/plans/",
    ".junie/memory/",
];

const EXCLUDE_HEADER = "# junie-github-action: agent artifacts, not part of the task result";

// Uses --git-common-dir so linked worktrees resolve to the shared info/exclude.
function resolveGitCommonDir(cwd?: string): string | undefined {
    try {
        const gitDir = execSync("git rev-parse --git-common-dir", {
            encoding: "utf-8",
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();

        if (!gitDir) {
            return undefined;
        }

        return path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd ?? process.cwd(), gitDir);
    } catch (error) {
        console.warn(`Could not locate the git directory: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * Appends `patterns` to `.git/info/exclude` (best-effort) so the commit step's
 * `git add .` skips untracked agent artifacts. Returns the newly added patterns.
 */
export function addGitExcludePatterns(patterns: string[], cwd?: string): string[] {
    if (patterns.length === 0) {
        return [];
    }

    const gitDir = resolveGitCommonDir(cwd);
    if (!gitDir) {
        console.warn("Skipping agent artifact excludes: not inside a git repository");
        return [];
    }

    const excludePath = path.join(gitDir, "info", "exclude");

    try {
        const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
        const existingPatterns = new Set(
            existing.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"))
        );

        const missing = patterns.filter(pattern => !existingPatterns.has(pattern));
        if (missing.length === 0) {
            console.log("Agent artifact excludes are already present");
            return [];
        }

        fs.mkdirSync(path.dirname(excludePath), {recursive: true});

        // Keep whatever the checkout already excluded and append below it.
        const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
        fs.writeFileSync(excludePath, `${prefix}${EXCLUDE_HEADER}\n${missing.join("\n")}\n`);

        console.log(`Excluded agent artifacts from commits: ${missing.join(", ")}`);
        return missing;
    } catch (error) {
        console.warn(
            `Could not write ${excludePath}, agent artifacts may be committed: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}
