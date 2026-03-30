import {describe, test, beforeAll, afterAll, expect} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import { testClient } from "../client/client";

describe("Trigger Junie in Issue", () => {
    let repoName: string;
    let testPassed = false;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo();
        await testClient.setupWorkflow(repoName);
    }, 30000);

    afterAll(async () => {
      if (repoName && testPassed) {
        await testClient.deleteTestRepo(repoName);
      } else if (repoName) {
        console.log(`⚠️ Keeping failed test repo: ${testClient.org}/${repoName}`);
      }
    });

    test("create PR on issue based on the description", async () => {
        const issueTitle = `Create new function`;
        const functionFile = "main.py";
        const requirementsFile = "requirements.txt";
        const functionName = "get_greeting()";
        const issueBody = `@junie-agent in src folder created by you add a file ${functionFile} containing a function ${functionName} that returns a string Hello, world!. Also create a ${requirementsFile} file.`;

        console.log(`Creating issue: "${issueTitle}" in ${testClient.org}/${repoName}`);

        const {data: issue} = await testClient.createIssue(issueTitle, issueBody, repoName)

        const issueNumber = issue.number;
        await testClient.waitForIssue(issueNumber);
        console.log(`Issue created: #${issue.number}`);

        await testClient.waitForJunieComment(issueNumber, INIT_COMMENT_BODY);

        const titleKeywords = ["greeting", "hello", "requirements"]

        const foundPR = await testClient.waitForPR(testClient.conditionIncludes(titleKeywords));

        const result = await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({[functionFile]: `def ${functionName}:`, [requirementsFile]: ``}));
        expect(result, "PR files check failed - required content not found in files").toBe(true);

        await testClient.waitForJunieComment(issueNumber, SUCCESS_FEEDBACK_COMMENT);
        testPassed = true;
    }, 900000);
});
