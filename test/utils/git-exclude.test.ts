import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {addGitExcludePatterns, AGENT_ARTIFACT_PATTERNS} from "../../src/utils/git-exclude";
import {execSync} from "child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("addGitExcludePatterns", () => {
    let repoDir: string;
    let excludePath: string;

    const readExclude = () => fs.readFileSync(excludePath, "utf-8");

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-exclude-test-"));
        execSync("git init -q", {cwd: repoDir});
        excludePath = path.join(repoDir, ".git", "info", "exclude");
    });

    afterEach(() => {
        fs.rmSync(repoDir, {recursive: true, force: true});
    });

    test("writes the patterns to .git/info/exclude", () => {
        const added = addGitExcludePatterns([".junie/plans/"], repoDir);

        expect(added).toEqual([".junie/plans/"]);
        expect(readExclude()).toContain(".junie/plans/");
    });

    test("keeps the patterns the checkout already excluded", () => {
        fs.mkdirSync(path.dirname(excludePath), {recursive: true});
        fs.writeFileSync(excludePath, "# existing rules\nbuild/\n");

        addGitExcludePatterns([".junie/plans/"], repoDir);

        const contents = readExclude();
        expect(contents).toContain("build/");
        expect(contents).toContain(".junie/plans/");
    });

    test("appends nothing on a second call", () => {
        addGitExcludePatterns(AGENT_ARTIFACT_PATTERNS, repoDir);
        const afterFirst = readExclude();

        const added = addGitExcludePatterns(AGENT_ARTIFACT_PATTERNS, repoDir);

        expect(added).toEqual([]);
        expect(readExclude()).toBe(afterFirst);
    });

    test("appends only the patterns that are missing", () => {
        addGitExcludePatterns([".junie/plans/"], repoDir);

        const added = addGitExcludePatterns([".junie/plans/", ".junie/memory/"], repoDir);

        expect(added).toEqual([".junie/memory/"]);
        expect(readExclude().match(/\.junie\/plans\//g)).toHaveLength(1);
    });

    test("does not append a pattern that is only present as a comment", () => {
        fs.mkdirSync(path.dirname(excludePath), {recursive: true});
        fs.writeFileSync(excludePath, "# .junie/plans/\n");

        const added = addGitExcludePatterns([".junie/plans/"], repoDir);

        expect(added).toEqual([".junie/plans/"]);
    });

    test("keeps an excluded plan file out of `git add .`", () => {
        addGitExcludePatterns(AGENT_ARTIFACT_PATTERNS, repoDir);

        fs.mkdirSync(path.join(repoDir, ".junie", "plans"), {recursive: true});
        fs.writeFileSync(path.join(repoDir, ".junie", "plans", "add-export-feature.md"), "# plan");
        fs.writeFileSync(path.join(repoDir, "src.ts"), "export const a = 1;");

        execSync("git add .", {cwd: repoDir});
        const staged = execSync("git diff --cached --name-only", {cwd: repoDir, encoding: "utf-8"});

        expect(staged).toContain("src.ts");
        expect(staged).not.toContain("add-export-feature.md");
    });

    test("returns nothing when there are no patterns to add", () => {
        expect(addGitExcludePatterns([], repoDir)).toEqual([]);
    });

    test("does not throw outside a git repository", () => {
        const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
        try {
            expect(addGitExcludePatterns([".junie/plans/"], plainDir)).toEqual([]);
        } finally {
            fs.rmSync(plainDir, {recursive: true, force: true});
        }
    });
});
