import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {e2eConfig} from "../config/test-config";
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
    });

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${e2eConfig.org}/${repoName}`);
        }
    });

    test(
        "posts review when PR is opened",
        async () => {
            const branchName = "feature/code-for-review";
            const filename = "src/app.js";
            const content = [
                "function add(a, b {\n",
                "  return a + bbb\n",
                "}\n",
            ].join("");

            const {data: mainBranch} = await testClient.getBranch(repoName);
            await testClient.createRef(repoName, branchName, mainBranch.commit.sha);

            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content).toString("base64"),
                filename,
                "Add code to be reviewed",
                branchName
            );

            const {data: pr} = await testClient.createPullRequest(
                repoName,
                branchName,
                "Add app.js with basic sum implementation",
                "Trigger built-in code review",
                "main"
            );

            const prNumber = pr.number;
            await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);
            await testClient.waitForInlineComments(prNumber, testClient.conditionInlineCommentsAtLeast(2))
            await testClient.checkInlineComments(
                prNumber,
                (comment) => {
                    return (testClient.conditionCodeBeforeSuggestionIncludes("bbb")(comment) || testClient.conditionCodeBeforeSuggestionIncludes("(a, b ")(comment))
                        && (testClient.conditionInlineCommentIncludes("a + b")(comment) || testClient.conditionInlineCommentIncludes("(a, b)")(comment));
                },
                2
            );
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
    });

    afterAll(async () => {
        if (repoName && testPassed) {
            await testClient.deleteTestRepo(repoName);
        } else if (repoName) {
            console.log(`⚠️ Keeping failed test repo: ${e2eConfig.org}/${repoName}`);
        }
    });

    test(
        "runs code review when commented '@junie-agent code-review'",
        async () => {
            const branchName = "feature/on-demand-review";
            const filename = "src/app-ondemand.js";
            const content = [
                "export function avg(arr {\n",
                "  const sum = arr.reduce((a,b)=> a + b, 0);\n",
                "  return arr.lengt ? 0 : (sum / arr.length)\n",
                "}\n",
            ].join("");

            const {data: mainBranch} = await testClient.getBranch(repoName);
            await testClient.createRef(repoName, branchName, mainBranch.commit.sha);
            await testClient.createOrUpdateFileContents(
                repoName,
                Buffer.from(content).toString("base64"),
                filename,
                "Add code for on-demand review",
                branchName
            );

            const {data: pr} = await testClient.createPullRequest(
                repoName,
                branchName,
                "Add app-ondemand.js for comment-triggered review",
                "This PR will be reviewed after a comment command.",
                "main"
            );

            const prNumber = pr.number;

            const triggerComment = "@junie-agent code-review";
            const {data: comment} = await testClient.createCommentToPROrIssue(repoName, prNumber, triggerComment);
            await testClient.waitForCommentReaction(comment.id);

            await testClient.waitForJunieComment(prNumber, INIT_COMMENT_BODY);
            await testClient.waitForInlineComments(prNumber, testClient.conditionInlineCommentsAtLeast(2))
            await testClient.checkInlineComments(
                prNumber,
                (comment) => {
                    return (testClient.conditionCodeBeforeSuggestionIncludes("avg(arr ")(comment) || testClient.conditionCodeBeforeSuggestionIncludes("lengt ")(comment))
                        && (testClient.conditionInlineCommentIncludes("avg(arr)")(comment) || testClient.conditionInlineCommentIncludes("length")(comment));
                },
                2
            );
            await testClient.waitForJunieComment(prNumber, SUCCESS_FEEDBACK_COMMENT);
            testPassed = true;
        },
        900000
    );
});
