import {execSync} from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Artifacts the agent writes into the checkout while it works, which must never
 * end up in a commit.
 *
 * Goal mode's planning sub-agent stores its plan as a markdown file under
 * `<project>/.junie/plans` (the CLI resolves that path against the project
 * directory, so it lands inside the repository the action commits from) and
 * picks a descriptive name per task, e.g. `add-export-feature.md`. The commit
 * step runs `git add .`, so without an exclude those plans are committed
 * alongside the real change.
 *
 * `.junie/memory` is written by the agent for the same reason and is equally
 * not part of the task's result.
 */
export const AGENT_ARTIFACT_PATTERNS = [
    ".junie/plans/",
    ".junie/memory/",
];

const EXCLUDE_HEADER = "# junie-github-action: agent artifacts, not part of the task result";

/**
 * Resolves the directory holding the repository metadata.
 *
 * `--git-common-dir` rather than `--git-dir`: in a linked worktree the latter
 * points at `.git/worktrees/<name>`, which has no `info/exclude` of its own,
 * while the common dir is shared by every worktree.
 */
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
 * Adds `patterns` to `.git/info/exclude` so the commit step's `git add .` skips them.
 *
 * `.git/info/exclude` is used rather than `.gitignore` on purpose: it is local to
 * the checkout and is itself never committed, so the action does not modify — and
 * cannot accidentally commit a change to — the consuming repository's ignore rules.
 *
 * Note this only keeps *untracked* files out of a commit. A file the repository
 * already tracks stays tracked; excludes do not apply to it.
 *
 * Writing is best-effort: a repository we cannot write the exclude file for should
 * not fail the run, so the failure is logged and the task proceeds.
 *
 * @returns the patterns that were newly appended (empty if all were already present)
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
