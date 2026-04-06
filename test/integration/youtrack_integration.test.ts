import {describe, test, beforeAll, expect} from "bun:test";
import {INIT_COMMENT_BODY, SUCCESS_FEEDBACK_COMMENT, YOUTRACK_EVENT_ACTION} from "../../src/constants/github";
import {testClient} from "../client/client";
import {youTrackClient} from "../client/youtrack-client";
import {e2eConfig} from "../config/test-config";

describe("YouTrack Integration", () => {
    let repoName: string;
    const workflowFileName = "junie-youtrack.yml";
    const youtrackBaseUrl = e2eConfig.youtrackBaseUrl;
    const youtrackToken = e2eConfig.youtrackToken;
    const projectId = e2eConfig.youtrackProjectId;

    beforeAll(async () => {
        repoName = await testClient.createTestRepo("junie-youtrack-test");
        console.log(`Using repository: ${repoName}`);
    }, 30000);

    test("trigger Junie via YouTrack 'Run Junie' button", async () => {
        const issueTitle = "Create File.java";
        const issueDescription = "Create file File.java with a new Cat class and update README.md accordingly. Use the code for Cat class from the attached cat_code.java file.";
        
        const issueId = await youTrackClient.createYouTrackIssue(projectId, issueTitle, issueDescription, youtrackBaseUrl, youtrackToken);

        const catCode = `class Cat {
    private String name;
    public Cat(String name) {
        this.name = name;
    }
    public void meow() {
        System.out.println("Meow! I am cat " + name);
    }
}`;
        await youTrackClient.addYouTrackAttachment(issueId, "cat_code.java", catCode, youtrackBaseUrl, youtrackToken);

        const testStartTime = new Date();
        
        console.log(`Triggering workflow dispatch for ${issueId} in ${testClient.org}/${repoName}...`);
        await testClient.triggerWorkflowDispatch(repoName, workflowFileName, {
            action: YOUTRACK_EVENT_ACTION,
            issue_id: issueId,
            issue_url: `${youtrackBaseUrl}/issue/${issueId}`,
            issue_title: issueTitle,
            issue_description: issueDescription,
            youtrack_base_url: youtrackBaseUrl
        });

        await verifyJunieSuccess(issueId, testStartTime);
    }, 900000);

    test("trigger Junie via YouTrack @junie-agent comment", async () => {
        const issueTitle = "Create File.java";
        const issueDescription = "Create file File.java with a new Cat class and update README.md accordingly. Use the code for Cat class from the attached cat_code.java file.";
        const triggerComment = "@junie-agent do the task and add README";

        const issueId = await youTrackClient.createYouTrackIssue(projectId, issueTitle, issueDescription, youtrackBaseUrl, youtrackToken);

        const catCode = `class Cat {
    private String name;
    public Cat(String name) {
        this.name = name;
    }
    public void meow() {
        System.out.println("Meow! I am cat " + name);
    }
}`;
        await youTrackClient.addYouTrackAttachment(issueId, "cat_code.java", catCode, youtrackBaseUrl, youtrackToken);

        const testStartTime = new Date();

        console.log(`Posting trigger comment to YouTrack issue ${issueId}...`);
        await youTrackClient.addYouTrackComment(issueId, triggerComment, youtrackBaseUrl, youtrackToken);

        await verifyJunieSuccess(issueId, testStartTime);
    }, 900000);

    async function verifyJunieSuccess(issueId: string, testStartTime: Date) {
        const filename = "File.java";
        
        console.log(`Verifying comments in YouTrack issue ${issueId}...`);
        await youTrackClient.waitForYouTrackComment(issueId, INIT_COMMENT_BODY, youtrackBaseUrl, youtrackToken);
        const foundYoutrackComment = await youTrackClient.waitForYouTrackComment(issueId, SUCCESS_FEEDBACK_COMMENT, youtrackBaseUrl, youtrackToken);
        console.log(`Found YouTrack comment: ${foundYoutrackComment.text}`);
        const prLinkMatch = foundYoutrackComment.text.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
        const prNumber = parseInt(prLinkMatch![1]);
        console.log(`Found PR #${prNumber} in YouTrack comment`);
        const foundPR = await testClient.waitForPR(testClient.conditionPRNumberEquals(prNumber), testStartTime);

        console.log(`Verifying files in PR #${foundPR.number}...`);
        const result = await testClient.checkPRFiles(foundPR, testClient.conditionPRFilesInclude({
            [filename]: "System.out.println(\"Meow! I am cat \" + name);",
            "README.md": "Cat"
        }));
        expect(result).toBe(true);

        console.log(`Verifying PR link in YouTrack issue ${issueId}...`);
        await youTrackClient.waitForYouTrackComment(issueId, `pull/${foundPR.number}`, youtrackBaseUrl, youtrackToken);

        console.log(`Closing PR #${foundPR.number}...`);
        await testClient.closePullRequest(foundPR.number);
        await testClient.waitForClosedPR(foundPR.number);

        console.log(`Deleting YouTrack issue ${issueId}...`);
        await youTrackClient.deleteYouTrackIssue(issueId, youtrackBaseUrl, youtrackToken);
    }
});
