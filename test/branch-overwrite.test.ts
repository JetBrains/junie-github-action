import {afterEach, describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {createNewBranch} from "../src/github/operations/branch";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]) {
    return execFileSync("git", args, {cwd, encoding: "utf-8"}).trim();
}

function createRepositoryWithRemote(existingBranch: boolean) {
    const tempDir = mkdtempSync(join(tmpdir(), "junie-branch-overwrite-"));
    tempDirs.push(tempDir);

    const remoteDir = join(tempDir, "remote.git");
    const seedDir = join(tempDir, "seed");
    const workDir = join(tempDir, "work");

    git(tempDir, "init", "--bare", remoteDir);

    git(tempDir, "clone", remoteDir, seedDir);
    git(seedDir, "config", "user.email", "test@example.com");
    git(seedDir, "config", "user.name", "Test User");
    writeFileSync(join(seedDir, "base.txt"), "base\n");
    git(seedDir, "add", "base.txt");
    git(seedDir, "commit", "-m", "base");
    git(seedDir, "branch", "-M", "main");
    git(seedDir, "push", "origin", "main");

    if (existingBranch) {
        git(seedDir, "checkout", "-b", "junie/issue-123");
        writeFileSync(join(seedDir, "old.txt"), "old branch content\n");
        git(seedDir, "add", "old.txt");
        git(seedDir, "commit", "-m", "old branch commit");
        git(seedDir, "push", "origin", "junie/issue-123");
    }

    git(tempDir, "clone", remoteDir, workDir);
    git(workDir, "fetch", "origin", "main");

    let oldBranchCommit: string | undefined;
    if (existingBranch) {
        git(workDir, "fetch", "origin", "junie/issue-123");
        git(workDir, "checkout", "-B", "junie/issue-123", "origin/junie/issue-123");
        oldBranchCommit = git(workDir, "rev-parse", "HEAD");
    }

    return {workDir, oldBranchCommit};
}

afterEach(() => {
    process.chdir(originalCwd);
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop()!, {recursive: true, force: true});
    }
});

describe("createNewBranch", () => {
    test("overwrites an existing ticket branch from the requested base", async () => {
        const {workDir, oldBranchCommit} = createRepositoryWithRemote(true);

        process.chdir(workDir);

        const branchInfo = await createNewBranch("main", "junie/issue-123", undefined);
        const currentBranch = git(workDir, "branch", "--show-current");
        const currentCommit = git(workDir, "rev-parse", "HEAD");
        const baseCommit = git(workDir, "rev-parse", "origin/main");

        expect(branchInfo.workingBranch).toBe("junie/issue-123");
        expect(branchInfo.isNewBranch).toBe(true);
        expect(currentBranch).toBe("junie/issue-123");
        expect(currentCommit).toBe(baseCommit);
        expect(currentCommit).not.toBe(oldBranchCommit);
    });

    test("creates a missing ticket branch from the requested base", async () => {
        const {workDir} = createRepositoryWithRemote(false);

        process.chdir(workDir);

        const branchInfo = await createNewBranch("main", "junie/issue-123", undefined);
        const currentBranch = git(workDir, "branch", "--show-current");
        const currentCommit = git(workDir, "rev-parse", "HEAD");
        const baseCommit = git(workDir, "rev-parse", "origin/main");

        expect(branchInfo.workingBranch).toBe("junie/issue-123");
        expect(branchInfo.isNewBranch).toBe(true);
        expect(currentBranch).toBe("junie/issue-123");
        expect(currentCommit).toBe(baseCommit);
    });
});