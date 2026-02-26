import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {testClient} from "../client/client";

describe("Automatic Merge Conflict Resolution", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
    }, 15000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test("automatically resolve merge conflict on push to main", async () => {
        await testMergeConflictResolve(repoName, async (repoName, branchName) => {
            await testClient.setupWorkflow(
                repoName,
                ".github/workflows/resolve-conflicts.yml",
                "test/workflows/resolve-conflicts.yml"
            );
            await testClient.setupWorkflow(
                repoName,
                ".github/workflows/resolve-conflicts.yml",
                "test/workflows/resolve-conflicts.yml",
                undefined,
                branchName
            );
        });

        testPassed = true;
    }, 900000);
});

describe("In comment Merge Conflict Resolution", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
    }, 15000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test("in comment resolve merge conflict on push to main", async () => {
        await testMergeConflictResolve(repoName, async (repoName, branchName) => {
            await testClient.setupWorkflow(
                repoName,
                ".github/workflows/junie.yml",
                "test/workflows/junie.yml",
                (content) => content.replace(
                    "use_single_comment: true",
                    "use_single_comment: true\n          create_new_branch_for_pr: \"true\""
                ));
            await testClient.setupWorkflow(
                repoName,
                ".github/workflows/junie.yml",
                "test/workflows/junie.yml",
                (content) => content.replace(
                    "use_single_comment: true",
                    "use_single_comment: true\n          create_new_branch_for_pr: \"true\""),
                branchName
            );
        }, async (prNumber: number) => {
            console.log(`Commenting "@junie-agent resolve merge conflicts" on PR #${prNumber}`);
            const {data: comment} = await testClient.createCommentToPROrIssue(repoName, prNumber, "@junie-agent resolve merge conflicts");
            await testClient.waitForCommentReaction(comment.id);
        });

        testPassed = true;
    }, 900000);
});

async function testMergeConflictResolve(repoName: string, setupWorkflows: (repoName: string, branchName: string) => Promise<void>, resolveConflictInComment: (prNumber: number) => Promise<void> = async () => {
}) {
    const branchName = "feature-conflict";
    const filename = "app.ts";
    const initialContent = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const mainUpdateContent = "export function add(a: number, b: number) {\n  const c = a + b;\n  return c;\n}\n";
    const branchUpdateContent = "export function add(a: number, b: number) {\n  return 2 * (a + b);\n}\n";

    console.log(`Setting up conflict in ${testClient.org}/${repoName}`);

    const initialFile = await testClient.createOrUpdateFileContents(
        repoName, Buffer.from(initialContent).toString("base64"),
        filename,
        "Initial version", "main"
    );
    await new Promise(resolve => setTimeout(resolve, 6000));

    const {data: mainBranch} = await testClient.getBranch(repoName);

    await testClient.createRef(repoName, branchName, mainBranch.commit.sha);

    await testClient.createOrUpdateFileContents(
        repoName, Buffer.from(branchUpdateContent).toString("base64"),
        filename,
        "Update function in feature", branchName, initialFile.data.content!.sha
    );

    const {data: pr} = await testClient.createPullRequest(
        repoName, branchName, "Update function", "This PR should have a merge conflict after push to main", "main"
    );

    const prNumber = pr.number;
    console.log(`PR created: #${prNumber}`);
    await setupWorkflows(repoName, branchName);
    await testClient.createOrUpdateFileContents(
        repoName, Buffer.from(mainUpdateContent).toString("base64"),
        filename,
        "Update version in main", "main", initialFile.data.content!.sha
    );
    await new Promise(resolve => setTimeout(resolve, 6000));

    await resolveConflictInComment(prNumber)

    await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);

    console.log(`Pushed to main, waiting for Junie to resolve conflict in PR #${prNumber}`);

    await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);

    const titleKeywords = ["resolve", "conflict", "merge"];
    const foundPR = await testClient.waitForPR(testClient.conditionIncludes(titleKeywords));

    await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({
        [filename]: ["2 * (a + b)", "a + b;"]
    }, "OR"));

    const foundPR2 = await testClient.waitForPR(testClient.conditionIncludes(titleKeywords) && testClient.conditionPRNumberNotEquals(foundPR.number));

    await testClient.checkPRFiles(foundPR2, testClient.conditionPRFilesInclude({
        [filename]: ["2 * (a + b)", "a + b;"]
    }, "OR"));
};
