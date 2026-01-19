import {Octokit} from "@octokit/rest";
import * as fs from "node:fs";
import * as path from "node:path";
import { e2eConfig } from "../config/test-config";

export const TEST_CONFIG = {
    token: e2eConfig.githubToken,
    org: e2eConfig.org,
};

let currentRepo = "";

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

export async function setupWorkflow(repoName: string) {
    const workflowPath = path.join(process.cwd(), "test/workflows/junie.yml");
    const workflowContent = fs.readFileSync(workflowPath, "utf-8");

    await octokit.repos.createOrUpdateFileContents({
        owner: TEST_CONFIG.org,
        repo: repoName,
        path: ".github/workflows/junie.yml",
        message: "Add Junie workflow",
        content: Buffer.from(workflowContent).toString("base64"),
    });
}

export async function deleteTestRepo(repoName: string) {
  console.log(`Deleting test repository: ${TEST_CONFIG.org}/${repoName}`);
  await octokit.repos.delete({
    owner: TEST_CONFIG.org,
    repo: repoName,
  });
}

export async function startPoll(
    errorMessage: string,
    options: {
        pollDelayMs?: number;
        pollIntervalMs?: number;
        timeoutMs?: number;
        errorDetails?: () => Promise<string> | string;
    },
    call: () => Promise<boolean> | boolean
) {
    const {
        pollDelayMs = 0,
        pollIntervalMs = 30000,
        timeoutMs = 12 * 60 * 1000,
        errorDetails
    } = options;

    if (pollDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, pollDelayMs));
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            if (await call()) {
                return;
            }
        } catch (e) {
            console.error("Error during poll call:", e);
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    const details = errorDetails ? `\n details: ${await errorDetails()}` : "";
    const repoUrl = `https://github.com/${TEST_CONFIG.org}/${currentRepo}`;
    throw new Error(`${errorMessage}; Repo actions ${repoUrl}/actions ;${details}`);
}

export async function waitForJunieComment(issueNumber: number, message: string): Promise<void> {
    console.log(`Waiting for Junie to post comment containing "${message}" in issue #${issueNumber} in ${currentRepo}...`);

    await startPoll(
        `Junie didn't post comment containing "${message}" in issue #${issueNumber}`,
        {},
        async () => {
            const { data: comments } = await octokit.issues.listComments({
                owner: TEST_CONFIG.org,
                repo: currentRepo,
                issue_number: issueNumber,
            });

            const junieComment = comments.find(c => c.body?.includes(message));

            if (junieComment) {
                console.log(`Found comment with message: "${message}"`);
                return true;
            }
            return false;
        }
    );
}

export async function waitForPR(options?: { 
    expectedFiles?: string[], 
    fileContentChecks?: { [filename: string]: string } 
}): Promise<void> {
    console.log(`Waiting for Junie to create a PR in ${currentRepo}...`);

    await startPoll(
        `Junie didn't create a PR in ${currentRepo} with expected files/content`,
        {},
        async () => {
            const {data: pulls} = await octokit.pulls.list({
                owner: TEST_CONFIG.org,
                repo: currentRepo,
                state: "open",
            });

            if (pulls.length > 0) {
                const pr = pulls[0];
                console.log(`PR found: ${pr.html_url}`);

                const {data: files} = await octokit.pulls.listFiles({
                    owner: TEST_CONFIG.org,
                    repo: currentRepo,
                    pull_number: pr.number,
                });

                if (options?.expectedFiles) {
                    for (const expectedFile of options.expectedFiles) {
                        if (!files.some(f => f.filename.includes(expectedFile))) {
                            console.log(`PR found but missing file: ${expectedFile}`);
                            return false;
                        }
                    }
                }

                if (options?.fileContentChecks) {
                    for (const [filename, expectedSnippet] of Object.entries(options.fileContentChecks)) {
                        const file = files.find(f => f.filename.includes(filename));
                        if (!file) {
                            console.log(`PR found but missing file for content check: ${filename}`);
                            return false;
                        }

                        const { data: contentData } = await octokit.repos.getContent({
                            owner: TEST_CONFIG.org,
                            repo: currentRepo,
                            path: file.filename,
                            ref: pr.head.sha,
                        });

                        if ("content" in contentData && typeof contentData.content === "string") {
                            const decodedContent = Buffer.from(contentData.content, "base64").toString("utf-8");
                            if (!decodedContent.includes(expectedSnippet)) {
                                console.log(`Content of ${file.filename} doesn't match expected snippet.`);
                                return false;
                            }
                        } else {
                            console.log(`Could not get content for ${file.filename}`);
                            return false;
                        }
                    }
                }

                return true;
            }
            return false;
        }
    );
}
