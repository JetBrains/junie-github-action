import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import {e2eConfig} from "../config/test-config";
import {testClient} from "../client/client";

describe("Trigger Junie in Issue Comment", () => {
    let repoName: string;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName);
    });

    afterAll(async () => {
        if (repoName) {
            await testClient.deleteTestRepo(repoName);
        }
    });

    test("create PR based on comment in issue", async () => {
        const issueTitle = "Feature Request: Math Utilities";
        const issueBody = "We need some basic math utilities in this project.";
        const filename = "math_ops.ts";
        const functionName = "calculate_factorial(n)";
        
        console.log(`Creating issue: "${issueTitle}" in ${e2eConfig.org}/${repoName}`);
        const {data: issue} = await testClient.createIssue(issueTitle, issueBody, repoName);
        const issueNumber = issue.number;
        console.log(`Issue created: #${issueNumber}`);

        const commentBody = `@junie-agent please implement a function ${functionName} in a new file ${filename}. The function should return the factorial of n. Also add a README.md file.`;
        console.log(`Commenting on Issue #${issueNumber}: "${commentBody}"`);

        const { data: comment } = await testClient.createCommentToPROrIssue(repoName, issueNumber, commentBody);

        await testClient.waitForCommentReaction(comment.id);

        await testClient.waitForJunieComment(issueNumber, INIT_COMMENT_BODY);

        const titleKeywords = ["factorial", "math", "README"];
        await testClient.waitForPR(testClient.conditionIncludes(titleKeywords), {
            [filename]: "calculate_factorial",
            "README.md": ""
        });

        await testClient.waitForJunieComment(issueNumber, SUCCESS_FEEDBACK_COMMENT);
    }, 900000);
});
