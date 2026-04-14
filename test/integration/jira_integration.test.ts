import {describe, test, beforeAll, expect} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT, JIRA_EVENT_ACTION} from "../../src/constants/github";
import {testClient} from "../client/client";
import {jiraTestClient} from "../client/jira-client";
import {e2eConfig} from "../config/test-config";

describe("Jira Integration", () => {
    let repoName: string;
    const workflowFileName = "junie-jira.yml";
    const jiraBaseUrl = e2eConfig.jiraBaseUrl;
    const jiraEmail = e2eConfig.jiraEmail;
    const jiraApiToken = e2eConfig.jiraApiToken;
    const projectKey = e2eConfig.jiraProjectKey;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo("junie-jira-test");
        console.log(`Using repository: ${repoName}`);
    }, 30000);

    test("trigger Junie via Jira workflow dispatch", async () => {
        const issueTitle = "Create Calculator.java";
        const issueDescription = "Create file Calculator.java with a Calculator class and update README.md accordingly. Use the method signatures from the attached calculator_spec.txt file.";

        const issueKey = await jiraTestClient.createJiraIssue(projectKey, issueTitle, issueDescription, jiraBaseUrl, jiraEmail, jiraApiToken);

        const calculatorSpec = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
    public int subtract(int a, int b) {
        return a - b;
    }
    public int multiply(int a, int b) {
        return a * b;
    }
}`;
        const attachment = await jiraTestClient.addJiraAttachment(issueKey, "calculator_spec.txt", calculatorSpec, jiraBaseUrl, jiraEmail, jiraApiToken);

        const issueAttachments = JSON.stringify([{
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            content: attachment.contentUrl
        }]);

        const testStartTime = new Date();

        console.log(`Triggering workflow dispatch for ${issueKey} in ${testClient.org}/${repoName}...`);
        await testClient.triggerWorkflowDispatch(repoName, workflowFileName, {
            action: JIRA_EVENT_ACTION,
            issue_key: issueKey,
            issue_summary: issueTitle,
            issue_description: issueDescription,
            issue_attachments: issueAttachments
        });

        await verifyJunieSuccess(issueKey, testStartTime);
    }, 900000);

    test("trigger Junie via Jira @junie comment", async () => {
        const issueTitle = "Create Calculator.java";
        const issueDescription = "Create file Calculator.java with a Calculator class and update README.md accordingly. Use the method signatures from the attached calculator_spec.txt file.";
        const triggerComment = "@junie do the task and add README";

        const issueKey = await jiraTestClient.createJiraIssue(projectKey, issueTitle, issueDescription, jiraBaseUrl, jiraEmail, jiraApiToken);

        const calculatorSpec = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
    public int subtract(int a, int b) {
        return a - b;
    }
    public int multiply(int a, int b) {
        return a * b;
    }
}`;
        await jiraTestClient.addJiraAttachment(issueKey, "calculator_spec.txt", calculatorSpec, jiraBaseUrl, jiraEmail, jiraApiToken);

        const testStartTime = new Date();

        console.log(`Posting trigger comment to Jira issue ${issueKey}...`);
        await jiraTestClient.addJiraComment(issueKey, triggerComment, jiraBaseUrl, jiraEmail, jiraApiToken);

        await verifyJunieSuccess(issueKey, testStartTime);
    }, 900000);

    async function verifyJunieSuccess(issueKey: string, testStartTime: Date) {
        const filename = "Calculator.java";

        console.log(`Verifying comments in Jira issue ${issueKey}...`);
        await jiraTestClient.waitForJiraComment(issueKey, INIT_COMMENT_BODY, jiraBaseUrl, jiraEmail, jiraApiToken);
        const foundJiraComment = await jiraTestClient.waitForJiraComment(issueKey, SUCCESS_FEEDBACK_COMMENT, jiraBaseUrl, jiraEmail, jiraApiToken);
        console.log(`Found Jira comment: ${foundJiraComment.text}`);
        const prLinkMatch = foundJiraComment.text.match(/https:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/pull\/(\d+)/);
        const prNumber = parseInt(prLinkMatch![1]);
        console.log(`Found PR #${prNumber} in Jira comment`);
        const foundPR = await testClient.waitForPR(testClient.conditionPRNumberEquals(prNumber), testStartTime);

        console.log(`Verifying files in PR #${foundPR.number}...`);
        const result = await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({
            [filename]: "return a + b;",
            "README.md": "Calculator"
        }));
        expect(result).toBe(true);

        console.log(`Verifying PR link in Jira issue ${issueKey}...`);
        await jiraTestClient.waitForJiraComment(issueKey, `pull/${foundPR.number}`, jiraBaseUrl, jiraEmail, jiraApiToken);

        console.log(`Closing PR #${foundPR.number}...`);
        await testClient.closePullRequest(foundPR.number);
        await testClient.waitForClosedPR(foundPR.number);

        console.log(`Deleting Jira issue ${issueKey}...`);
        await jiraTestClient.deleteJiraIssue(issueKey, jiraBaseUrl, jiraEmail, jiraApiToken);
    }
});
