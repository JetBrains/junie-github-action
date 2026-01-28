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

    async waitForJunieComment(issueOrPRNumber: number, message: string): Promise<void> {
        console.log(`Waiting for Junie to post comment containing "${message}" in issue #${issueOrPRNumber} in ${this.currentRepo}...`);

        await startPoll(
            `Junie didn't post comment containing "${message}" in issue #${issueOrPRNumber}`,
            {},
            async () => {
                const { data: comments } = await this.getAllIssueOrPRComments(issueOrPRNumber);
                const junieComment = comments.find(c => c.body?.includes(message));

                if (junieComment) {
                    console.log(`Found comment with message: "${message}"`);
                    return true;
                }
                return false;
            }
        );
    }

    async waitForCommentReaction(commentId: number, reactionType: string = "+1"): Promise<void> {
        console.log(`Waiting for reaction "${reactionType}" on comment #${commentId} in ${this.currentRepo}...`);

        await startPoll(
            `Reaction "${reactionType}" not found on comment #${commentId}`,
            {},
            async () => {
                const { data: reactions } = await this.getAllCommentReactions(commentId);

                const hasReaction = reactions.some(r => r.content === reactionType);
                if (hasReaction) {
                    console.log(`Found "${reactionType}" reaction on comment #${commentId}`);
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
        let foundPR: PullRequest | undefined;
        await startPoll(
            `Junie didn't create a PR in ${this.currentRepo}`,
            {},
            async () => {
                const { data: pulls } = await this.getAllPRs();
                for (const pull of pulls) {
                    if (await condition(pull)) {
                        console.log(`PR found: ${pull.html_url}`);
                        foundPR = pull;
                        return true;
                    }
                }
                return false;
            }
        );
        if (foundPR) {
            const hasExpectedContent = await this.checkPRFiles(foundPR, fileContentChecks);
            if (!hasExpectedContent) {
                throw new Error(`PR files don't match expected content`);
            }
        }
    }

    async waitForPRUpdate(
        prNumber: number,
        fileContentChecks: { [filename: string]: string },
        fileCount: number
    ): Promise<void> {
        console.log(`Waiting for Junie to update PR #${prNumber} in ${this.currentRepo}...`);
        let foundPR: PullRequest | undefined;
        await startPoll(
            `Junie didn't update PR #${prNumber} in ${this.currentRepo}`,
            {},
            async () => {
                const pr  = await this.getPRByNumber(prNumber);
                foundPR = pr;
                const { data: files } = await this.getAllPRFiles(pr);
                const fileCountNew = files.length;
                return fileCountNew > fileCount;
            }
        );
        if (foundPR) {
            console.log(`Checking PR #${prNumber} for updates...`);
            const hasExpectedContent = await this.checkPRFiles(foundPR, fileContentChecks);
            if (!hasExpectedContent) {
                throw new Error(`PR #${prNumber} files don't match expected content`);
            }
        }
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
                console.log(`Content of ${expectedSnippet} doesn't match expected snippet.`);
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

    private async getAllIssueOrPRComments(issueOrPRNumber: number) {
        return this.octokit.issues.listComments({
            owner: this.org,
            repo: this.currentRepo,
            issue_number: issueOrPRNumber,
        });
    }

    async createOrUpdateFileContents(
        repoName: string,
        content: string,
        path: string,
        message: string,
        branch: string = "main"
    ) {
        return this.octokit.repos.createOrUpdateFileContents({
            owner: this.org,
            repo: repoName,
            path: path,
            message: message,
            content: content,
            branch: branch
        });
    }

    conditionIncludes(titles: string[]) {
        return (pr: PullRequest) => {
            return titles.some(title => pr.title.includes(title));
        };
    }

    async getBranch(repoName: string){
        return this.octokit.repos.getBranch({
            owner: e2eConfig.org,
            repo: repoName,
            branch: "main",
        });
    }

    async createRef(repoName: string, branchName: string, sha: string){
        return this.octokit.git.createRef({
            owner: e2eConfig.org,
            repo: repoName,
            ref: `refs/heads/${branchName}`,
            sha: sha,
        });
    }

    async createPullRequest(repoName: string, branchName: string, title: string, body: string, base: string = "main"){
        return this.octokit.pulls.create({
            owner: e2eConfig.org,
            repo: repoName,
            title: title,
            head: branchName,
            base: base,
            body: body,
        });
    }

    async createCommentToPROrIssue(repoName: string, issueOrPRNumber: number, commentBody: string){
        return this.octokit.issues.createComment({
            owner: e2eConfig.org,
            repo: repoName,
            issue_number: issueOrPRNumber,
            body: commentBody,
        });
    }

    private async getPRByNumber(prNumber: number): Promise<PullRequest>{
        const pulls = await this.getAllPRs();
        const pr = pulls.data.find(p => p.number === prNumber);
        return pr as PullRequest;
    }

    private async getAllCommentReactions(commentId: number){
        return this.octokit.reactions.listForIssueComment({
            owner: this.org,
            repo: this.currentRepo,
            comment_id: commentId,
        });
    }
}

export const testClient = new Client();
