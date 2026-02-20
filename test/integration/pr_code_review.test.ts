import {describe, test, beforeAll, afterAll, expect} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {testClient} from "../client/client";

describe("Code Review: Built-in", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(
            repoName,
            ".github/workflows/code-review.yml",
            "test/workflows/code-review.yml"
        );
    }, 15000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test(
        "posts review when PR is opened",
        async () => {
            const branchName = "feature/code-for-review";
            const filename1 = "src/app.js";
            const content1 = [
                "function add(a, b) {\n",
                "  return a + bb;\n",
                "}\n",
            ].join("");

            const filename2 = "src/calculator.js";
            const content2 = [
                "function multiply(a, b {\n",
                "  return a * b;\n",
                "}\n",
            ].join("");
            const {data: mainBranch} = await testClient.getBranch(repoName);
            await testClient.createRef(repoName, branchName, mainBranch.commit.sha);

            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content1).toString("base64"),
                filename1,
                "Add app.js with basic sum implementation",
                branchName
            );

            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content2).toString("base64"),
                filename2,
                "Add calculator with print statement",
                branchName
            );

            const {data: pr} = await testClient.createPullRequest(
                repoName,
                branchName,
                "Add calculator functions",
                "Trigger built-in code review",
                "main"
            );

            const prNumber = pr.number;
            await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);
            await testClient.waitForInlineComments(prNumber, testClient.conditionInlineCommentsAtLeast(2))
            const filteredComments = await testClient.getInlineComments(
                prNumber,
                (comment) => {
                    return testClient.conditionInlineCommentIncludes("multiply(a, b)")(comment)
                        || testClient.conditionInlineCommentIncludes("+ b;")(comment);
                }
            );
            const expectedLength = 2;
            expect(filteredComments.length, `Length of filtered comments is not ${expectedLength}. All filtered comments: ${filteredComments}`).toBe(expectedLength);
            await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);
            testPassed = true;
        },
        900000
    );
});

describe("Code Review: On-Demand via comment", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName);
    }, 15000);

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
        }
    });

    test(
        "runs code review when commented '@junie-agent code-review'",
        async () => {
            const branchName = "feature/on-demand-review";
            const filename1 = "src/app-ondemand.js";
            const content1 = [
                "export function avg(arr {\n",
                "  const sum = arr.reduce((a,b)=> a + b, 0);\n",
                "  return arr.length ? (sum / arr.length) : 0;\n",
                "}\n",
            ].join("");

            const filename2 = "src/stats.js";
            const content2 = [
                "function multiply(a, b {\n",
                "  return a * b;\n",
                "}\n",
            ].join("");
            const {data: mainBranch} = await testClient.getBranch(repoName);
            await testClient.createRef(repoName, branchName, mainBranch.commit.sha);
            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content1).toString("base64"),
                filename1,
                "Add code for on-demand review",
                branchName
            );
            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content2).toString("base64"),
                filename2,
                "Add stats with print statement",
                branchName
            );

            const {data: pr} = await testClient.createPullRequest(
                repoName,
                branchName,
                "Add statistics functions",
                "This PR will be reviewed after a comment command.",
                "main"
            );

            const prNumber = pr.number;

            const triggerComment = "@junie-agent code-review";
            const {data: comment} = await testClient.createCommentToPROrIssue(repoName, prNumber, triggerComment);
            await testClient.waitForCommentReaction(comment.id);

            await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);
            await testClient.waitForInlineComments(prNumber, testClient.conditionInlineCommentsAtLeast(2))
            const filteredComments = await testClient.getInlineComments(
                prNumber,
                (comment) => {
                    return testClient.conditionInlineCommentIncludes("multiply(a, b)")(comment)
                        || testClient.conditionInlineCommentIncludes("avg(arr)")(comment);
                }
            );
            const expectedLength = 2;
            expect(filteredComments.length, `Length of filtered comments is not ${expectedLength}. All filtered comments: ${filteredComments}`).toBe(expectedLength);
            await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);
            testPassed = true;
        },
        900000
    );
});
