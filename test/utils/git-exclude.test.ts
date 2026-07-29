import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    addGitExcludePatterns,
    GENERATED_ARTIFACT_PATTERNS,
    isRunningInGitHubActions,
    PLAN_FILE_PATTERNS
} from "../../src/utils/git-exclude";

describe('git-exclude', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-exclude-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    const readExclude = () => fs.readFileSync(path.join(tmpDir, '.git', 'info', 'exclude'), 'utf8');

    it('should create exclude file and write patterns', () => {
        fs.mkdirSync(path.join(tmpDir, '.git'));

        addGitExcludePatterns(['__pycache__/', '*.py[cod]'], tmpDir);

        expect(readExclude()).toBe('__pycache__/\n*.py[cod]\n');
    });

    it('should append patterns to existing content without trailing newline', () => {
        fs.mkdirSync(path.join(tmpDir, '.git', 'info'), {recursive: true});
        fs.writeFileSync(path.join(tmpDir, '.git', 'info', 'exclude'), '# comment');

        addGitExcludePatterns(['node_modules/'], tmpDir);

        expect(readExclude()).toBe('# comment\nnode_modules/\n');
    });

    it('should not duplicate already present patterns', () => {
        fs.mkdirSync(path.join(tmpDir, '.git'));

        addGitExcludePatterns(['node_modules/', 'target/'], tmpDir);
        addGitExcludePatterns(['node_modules/', 'out/'], tmpDir);

        expect(readExclude()).toBe('node_modules/\ntarget/\nout/\n');
    });

    it('should do nothing when there is no git directory', () => {
        addGitExcludePatterns(['node_modules/'], tmpDir);

        expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(false);
    });

    it('should cover typical build and cache artifacts', () => {
        expect(GENERATED_ARTIFACT_PATTERNS).toContain('__pycache__/');
        expect(GENERATED_ARTIFACT_PATTERNS).toContain('*.py[cod]');
        expect(GENERATED_ARTIFACT_PATTERNS).toContain('node_modules/');
        expect(GENERATED_ARTIFACT_PATTERNS).toContain('target/');
        expect(GENERATED_ARTIFACT_PATTERNS).toContain('.DS_Store');
    });

    it('should keep plan patterns separate from artifact patterns', () => {
        expect(PLAN_FILE_PATTERNS).toContain('.junie/');
        expect(PLAN_FILE_PATTERNS).toContain('*-plan.md');
        for (const pattern of PLAN_FILE_PATTERNS) {
            expect(GENERATED_ARTIFACT_PATTERNS).not.toContain(pattern);
        }
    });

    describe('isRunningInGitHubActions', () => {
        const original = process.env.GITHUB_ACTIONS;

        afterEach(() => {
            if (original === undefined) {
                delete process.env.GITHUB_ACTIONS;
            } else {
                process.env.GITHUB_ACTIONS = original;
            }
        });

        it('should be true only when GITHUB_ACTIONS is true', () => {
            process.env.GITHUB_ACTIONS = 'true';
            expect(isRunningInGitHubActions()).toBe(true);

            delete process.env.GITHUB_ACTIONS;
            expect(isRunningInGitHubActions()).toBe(false);
        });
    });
});
