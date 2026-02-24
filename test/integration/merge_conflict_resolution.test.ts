import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {testClient} from "../client/client";

describe("Automatic Merge Conflict Resolution (Cookbook 5)", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(
            repoName,
            ".github/workflows/resolve-conflicts.yml",
            "test/workflows/resolve-conflicts.yml"
        );
    }, 15000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test("automatically resolve merge conflict on push to main", async () => {
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
            "Update version in feature", branchName, initialFile.data.content!.sha
        );

        const {data: pr} = await testClient.createPullRequest(
            repoName, branchName, "Update version", "This PR should have a merge conflict after push to main", "main"
        );

        const prNumber = pr.number;
        console.log(`PR created: #${prNumber}`);
        await testClient.createOrUpdateFileContents(
            repoName, Buffer.from(mainUpdateContent).toString("base64"),
            filename,
            "Update version in main", "main", initialFile.data.content!.sha
        );

        console.log(`Pushed to main, waiting for Junie to resolve conflict in PR #${prNumber}`);

        await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);

        await testClient.waitForPR(async (pr) => {
            return await testClient.conditionPRNumberEquals(prNumber)(pr) &&
                await testClient.checkPRFiles(pr, testClient.conditionPRFilesInclude({
                    [filename]: "2 * ()))))"
                }));
        });

        testPassed = true;
    }, 900000);
});
