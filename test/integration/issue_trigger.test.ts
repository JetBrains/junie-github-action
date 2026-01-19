import {describe, test, beforeAll, afterAll} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT} from "../../src/constants/github";
import { e2eConfig } from "../config/test-config";
import {
    octokit,
    waitForJunieComment,
    waitForPR,
    createTestRepo,
    setupWorkflow,
    deleteTestRepo
} from "../utils/test-utils";

describe("Trigger Junie in Issue", () => {
    let repoName: string;

    beforeAll(async () => {
        repoName = await createTestRepo();
        await setupWorkflow(repoName);
    });

    afterAll(async () => {
      if (repoName) {
        await deleteTestRepo(repoName);
      }
    });

    test("create PR on issue based on the description", async () => {
        const issueTitle = `Create new function`;
        const functionFile = "main.py";
        const requirementsFile = "requirements.txt";
        const functionName = "get_greeting()";
        const issueBody = `@junie-agent in src folder created by you add a file ${functionFile} containing a function ${functionName} that returns a string Hello, world!. Also create a ${requirementsFile} file.`;

        console.log(`Creating issue: "${issueTitle}" in ${e2eConfig.org}/${repoName}`);

        const {data: issue} = await octokit.issues.create({
            owner: e2eConfig.org,
            repo: repoName,
            title: issueTitle,
            body: issueBody,
        });

        const issueNumber = issue.number;
        console.log(`Issue created: #${issue.number}`);

        await waitForJunieComment(issueNumber, INIT_COMMENT_BODY);

        await waitForPR({
            expectedFiles: [functionFile, requirementsFile],
            fileContentChecks: {
                [functionFile]: `def ${functionName}:`,
            }
        });

        await waitForJunieComment(issueNumber, SUCCESS_FEEDBACK_COMMENT);
    }, 900000);
});
