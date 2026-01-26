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

export const TEST_WORKFLOW_FILE_PATHS = {
    workflowFilePathInTestDirectory: "test/workflows/junie.yml",
    workflowFilePathInRepo: ".github/workflows/junie.yml"
};

export class Client {
    private octokit: Octokit;
    private org: string;
    public currentRepo: string = "";

    constructor() {
        this.octokit = new Octokit({ auth: e2eConfig.githubToken });
        this.org = e2eConfig.org;
    }

    async createTestRepo(): Promise<string> {
        const repoName = `junie-test-${Date.now()}`;
        console.log(`Creating test repository: ${this.org}/${repoName}`);

        await this.octokit.repos.createInOrg({
            org: this.org,
            name: repoName,
            auto_init: true,
        });

        this.currentRepo = repoName;
        return repoName;
    }

    async setupWorkflow(
        repoName: string,
        workflowFilePathInRepo: string = TEST_WORKFLOW_FILE_PATHS.workflowFilePathInRepo,
        workflowFilePathInTestDirectory: string = TEST_WORKFLOW_FILE_PATHS.workflowFilePathInTestDirectory
    ): Promise<void> {
        const workflowPath = path.join(process.cwd(), workflowFilePathInTestDirectory);
        const workflowContent = fs.readFileSync(workflowPath, "utf-8");

        await this.createOrUpdateFileContents(
            repoName,
            Buffer.from(workflowContent).toString("base64"),
            workflowFilePathInRepo,
            "Add Junie workflow"
        );
    }

    async deleteTestRepo(repoName: string): Promise<void> {
        console.log(`Deleting test repository: ${this.org}/${repoName}`);
        await this.octokit.repos.delete({
            owner: this.org,
            repo: repoName,
        });
    }

    async waitForJunieComment(issueNumber: number, message: string): Promise<void> {
        console.log(`Waiting for Junie to post comment containing "${message}" in issue #${issueNumber} in ${this.currentRepo}...`);

        await startPoll(
            `Junie didn't post comment containing "${message}" in issue #${issueNumber}`,
            {},
            async () => {
                const { data: comments } = await this.getAllIssueComments(issueNumber);
                const junieComment = comments.find(c => c.body?.includes(message));

                if (junieComment) {
                    console.log(`Found comment with message: "${message}"`);
                    return true;
                }
                return false;
            }
        );
    }

    async waitForPR(
        condition: (pr: PullRequest) => boolean | Promise<boolean>,
        fileContentChecks: { [filename: string]: string }
    ): Promise<void> {
        console.log(`Waiting for Junie to create a PR in ${this.currentRepo}...`);

        await startPoll(
            `Junie didn't create a PR in ${this.currentRepo} with expected files/content`,
            {},
            async () => {
                const { data: pulls } = await this.getAllPRs();
                for (const pull of pulls) {
                    if (await condition(pull)) {
                        console.log(`PR found: ${pull.html_url}`);
                        await this.checkPRFiles(pull, fileContentChecks);
                        return true;
                    }
                }
                return false;
            }
        );
    }

    createIssue(issueTitle: string, issueBody: string, repoName?: string) {
        return this.octokit.issues.create({
            owner: this.org,
            repo: repoName || this.currentRepo,
            title: issueTitle,
            body: issueBody,
        });
    }

    private async checkPRFiles(
        pr: PullRequest,
        fileContentChecks: { [filename: string]: string }
    ): Promise<boolean> {
        const { data: files } = await this.getAllPRFiles(pr);

        for (const [filename, expectedSnippet] of Object.entries(fileContentChecks)) {
            const file = files.find(f => f.filename.includes(filename));
            if (!file) {
                console.log(`PR found but missing file for content check: ${filename}`);
                return false;
            }

            const { data: contentData } = await this.getFileContent(pr.head.sha, file);

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

    private async getAllPRs() {
        return this.octokit.pulls.list({
            owner: this.org,
            repo: this.currentRepo,
            state: "open",
        });
    }

    private async getAllPRFiles(pr: PullRequest) {
        return this.octokit.pulls.listFiles({
            owner: this.org,
            repo: this.currentRepo,
            pull_number: pr.number,
        });
    }

    private async getFileContent(sha: string, file: GitHubFile) {
        return this.octokit.repos.getContent({
            owner: this.org,
            repo: this.currentRepo,
            path: file.filename,
            ref: sha,
        });
    }

    private async getAllIssueComments(issueNumber: number) {
        return this.octokit.issues.listComments({
            owner: this.org,
            repo: this.currentRepo,
            issue_number: issueNumber,
        });
    }

    private async createOrUpdateFileContents(
        repoName: string,
        content: string,
        path: string,
        message: string
    ) {
        return this.octokit.repos.createOrUpdateFileContents({
            owner: this.org,
            repo: repoName,
            path: path,
            message: message,
            content: content,
        });
    }

    conditionIncludes(titles: string[]) {
        return (pr: PullRequest) => {
            return titles.some(title => pr.title.includes(title));
        };
    }
}

export const testClient = new Client();
