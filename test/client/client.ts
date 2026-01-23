import {Octokit} from "@octokit/rest";
import * as fs from "node:fs";
import * as path from "node:path";
import {e2eConfig} from "../config/test-config";
import {
    startPoll
} from "../utils/test-utils";

import {RestEndpointMethodTypes} from "@octokit/rest";

type PullRequest = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];
type GitHubFile =
    | RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"][number]
    | NonNullable<RestEndpointMethodTypes["repos"]["getCommit"]["response"]["data"]["files"]>[number]
    | NonNullable<RestEndpointMethodTypes["repos"]["compareCommits"]["response"]["data"]["files"]>[number];

export const TEST_CONFIG = {
    token: e2eConfig.githubToken,
    org: e2eConfig.org,
};

export const TEST_WORKFLOW_FILE_PATHS = {
    workflowFilePathInTestDirectory: "test/workflows/junie.yml",
    workflowFilePathInRepo: ".github/workflows/junie.yml"
}

export let currentRepo = "";

export const octokit = new Octokit({auth: e2eConfig.githubToken});

export async function createTestRepo() {
    const repoName = `junie-test-${Date.now()}`;
    console.log(`Creating test repository: ${TEST_CONFIG.org}/${repoName}`);

    await octokit.repos.createInOrg({
        org: TEST_CONFIG.org,
        name: repoName,
        auto_init: true,
    });

    currentRepo = repoName;
    return repoName;
}

export async function setupWorkflow(repoName: string, workflowFilePathInRepo: string = TEST_WORKFLOW_FILE_PATHS.workflowFilePathInRepo, workflowFilePathInTestDirectory: string = TEST_WORKFLOW_FILE_PATHS.workflowFilePathInTestDirectory) {
    const workflowPath = path.join(process.cwd(), workflowFilePathInTestDirectory);
    const workflowContent = fs.readFileSync(workflowPath, "utf-8");

    await createOrUpdateFileContents(repoName, Buffer.from(workflowContent).toString("base64"), workflowFilePathInRepo, "Add Junie workflow");
}

export async function deleteTestRepo(repoName: string) {
    console.log(`Deleting test repository: ${TEST_CONFIG.org}/${repoName}`);
    await octokit.repos.delete({
        owner: TEST_CONFIG.org,
        repo: repoName,
    });
}

export async function waitForJunieComment(issueNumber: number, message: string): Promise<void> {
    console.log(`Waiting for Junie to post comment containing "${message}" in issue #${issueNumber} in ${currentRepo}...`);

    await startPoll(
        `Junie didn't post comment containing "${message}" in issue #${issueNumber}`,
        {},
        async () => {
            const {data: comments} = await getAllIssueCommits(issueNumber);

            const junieComment = comments.find(c => c.body?.includes(message));

            if (junieComment) {
                console.log(`Found comment with message: "${message}"`);
                return true;
            }
            return false;
        }
    );
}

export async function waitForPR(condition: (pr: PullRequest) => boolean | Promise<boolean>,
                                fileContentChecks: { [filename: string]: string }): Promise<void> {
    console.log(`Waiting for Junie to create a PR in ${currentRepo}...`);

    await startPoll(
        `Junie didn't create a PR in ${currentRepo} with expected files/content`,
        {},
        async () => {
            const {data: pulls} = await getAllPRs();
            for (const pull of pulls) {
                if (await condition(pull)) {
                    const pr = pull;
                    console.log(`PR found: ${pr.html_url}`);
                    checkPRFiles(pr, fileContentChecks)
                    return true;
                }
            }
            return false;
        }
    );
}

export function createIssue(issueTitle: string, issueBody: string, repoName: string = currentRepo) {
    return octokit.issues.create({
        owner: e2eConfig.org,
        repo: repoName,
        title: issueTitle,
        body: issueBody,
    });
}

export async function checkPRFiles(pr: PullRequest,
                                   fileContentChecks: { [filename: string]: string }) {
    const {data: files} = await getAllPRFiles(pr);

    for (const [filename, expectedSnippet] of Object.entries(fileContentChecks)) {
        const file = files.find(f => f.filename.includes(filename));
        if (!file) {
            console.log(`PR found but missing file for content check: ${filename}`);
            return false;
        }
        const {data: contentData} = await getFileContent(pr.head.sha, file)

        if ("content" in contentData && typeof contentData.content === "string") {
            const decodedContent = Buffer.from(contentData.content, "base64").toString("utf-8");
            if (!decodedContent.includes(expectedSnippet)) {
                console.log(`Content of ${file.filename} doesn't match expected snippet.`);
                return false;
            }
        }
    }
    return true;
}

export async function getAllPRs() {
    return octokit.pulls.list({
        owner: TEST_CONFIG.org,
        repo: currentRepo,
        state: "open",
    });
}

export async function getAllPRFiles(pr: PullRequest) {
    return octokit.pulls.listFiles({
        owner: TEST_CONFIG.org,
        repo: currentRepo,
        pull_number: pr.number,
    });
}

export async function getFileContent(sha: string, file: GitHubFile) {
    return octokit.repos.getContent({
        owner: TEST_CONFIG.org,
        repo: currentRepo,
        path: file.filename,
        ref: sha,
    });
}

export async function getAllIssueCommits(issueNumber: number) {
    return octokit.issues.listComments({
        owner: TEST_CONFIG.org,
        repo: currentRepo,
        issue_number: issueNumber,
    });
}

export async function createOrUpdateFileContents(repoName: string, content: string, path: string, message: string) {
    return octokit.repos.createOrUpdateFileContents({
        owner: TEST_CONFIG.org,
        repo: repoName,
        path: path,
        message: message,
        content: content,
    });
}

export async function conditionIncludes(titles: string[]) {
    return (pr: PullRequest) => {
        return titles.some(title => pr.title.includes(title));
    }
}
