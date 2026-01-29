import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {e2eConfig} from "../config/test-config";
import {testClient} from "../client/client";

describe("Trigger Junie in PR comment", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName);
    });

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${e2eConfig.org}/${repoName}`);
        }
    });

    test("apply changes to PR based on comment", async () => {
        const branchName = "feature-branch";
        const filename = "math_utils.py";
        const content = "def divide(a, b):\n    return a / b\n";

        console.log(`Setting up PR in ${e2eConfig.org}/${repoName}`);

        const {data: mainBranch} = await testClient.getBranch(repoName);

        await testClient.createRef(repoName, branchName, mainBranch.commit.sha);

        await testClient.createOrUpdateFileContents(
            repoName, Buffer.from(content).toString("base64"),
            filename,
            "Add math utils", branchName
        );

        const {data: pr} = await testClient.createPullRequest(repoName, branchName, "Add math utilities", "Basic math functions", "main");

        const prNumber = pr.number;
        console.log(`PR created: #${prNumber}`);
        const filesCount = pr.changed_files

        const commentBody = `@junie-agent add error handling to the divide function in ${filename} to handle division by zero. Add README.md`;
        console.log(`Commenting on PR #${prNumber}: "${commentBody}"`);

        const { data: comment } = await testClient.createCommentToPROrIssue(repoName, prNumber, commentBody);

        await testClient.waitForCommentReaction(comment.id);

        await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);

        const foundPR = await testClient.waitForPR(async (pr) => {
            return await testClient.conditionPRNumberEquals(prNumber)(pr) &&
                await testClient.checkPRFiles(pr, testClient.conditionPRFilesCountIncrease(filesCount));
        });

        await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({[filename]: "zero", ["README.md"]: ""}));

        await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);
        testPassed = true;
    }, 900000);
});
