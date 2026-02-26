import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {testClient} from "../client/client";

describe("Fix Failing CI: built-in", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName, ".github/workflows/fix-ci.yml", "test/workflows/fix-ci.yml");
        await testClient.setupWorkflow(repoName, ".github/workflows/ci.yml", "test/workflows/failing-ci.yml");
    }, 18000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test("Built-in Fix CI analysis", async () => {
        await testFixCi(repoName)
        testPassed = true;
    }, 900000);
});

describe("Fix Failing CI: via comment", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName, ".github/workflows/ci.yml", "test/workflows/failing-ci.yml");
        await testClient.setupWorkflow(repoName, ".github/workflows/junie.yml", "test/workflows/junie.yml", (content) => content.replace(
            "use_single_comment: true",
            "use_single_comment: true\n          create_new_branch_for_pr: \"true\""
        ));
    }, 18000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });
    test("Fix CI via comment", async () => {
        await testFixCi(repoName, async (prNumber: number) => {
            console.log(`Commenting "@junie-agent fix-ci" on PR #${prNumber}`);
            const {data: comment} = await testClient.createCommentToPROrIssue(repoName, prNumber, "@junie-agent fix-ci");
            await testClient.waitForCommentReaction(comment.id);
        })
        testPassed = true;
    }, 900000);
});

async function testFixCi(repoName: string, fixCiInComment: (prNumber: number) => Promise<void> = async () => {}) {
    const branchName = "feature/failing-ci";
    const {data: mainBranch} = await testClient.getBranch(repoName);
    await testClient.createRef(repoName, branchName, mainBranch.commit.sha);
    const fileName = `${branchName.replace(/\//g, '_')}.ts`
    await testClient.createOrUpdateFileContents(
        repoName,
        Buffer.from("console.log('fail';").toString("base64"),
        fileName,
        "Add failing code",
        branchName
    );
    const {data: pr} = await testClient.createPullRequest(repoName, branchName, "Trigger test", "Should trigger CI", "main");
    fixCiInComment(pr.number);
    await testClient.waitForJunieComment(pr.number, INIT_COMMENT_BODY);
    const titleKeywords = ["ci", "fail", "fix"]

    const foundPR = await testClient.waitForPR(testClient.conditionIncludes(titleKeywords));
    await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({[fileName]: "console.log('fail');"}));
    console.log(`Waiting for CI to pass on PR #${foundPR.number}...`);
    await testClient.waitForSuccessfulCI(foundPR.number);
    await testClient.waitForJunieComment(pr.number, SUCCESS_FEEDBACK_COMMENT);
};
