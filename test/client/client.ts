import {Octokit} from "@octokit/rest";
import * as fs from "node:fs";
import * as path from "node:path";
import {e2eConfig} from "../config/test-config";
import {
    startPoll
} from "../utils/test-utils";

import {RestEndpointMethodTypes} from "@octokit/rest";

type PullRequest = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];
type Comment = RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][number];
type Reaction = RestEndpointMethodTypes["reactions"]["listForIssueComment"]["response"]["data"][number];
type GitHubFile =
    | RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"][number]
    | NonNullable<RestEndpointMethodTypes["repos"]["getCommit"]["response"]["data"]["files"]>[number]
    | NonNullable<RestEndpointMethodTypes["repos"]["compareCommits"]["response"]["data"]["files"]>[number];
type ReviewComment = RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number];

export const TEST_WORKFLOW_FILE_PATHS = {
    workflowFilePathInTestDirectory: "test/workflows/junie.yml",
    workflowFilePathInRepo: ".github/workflows/junie.yml"
};

export class Client {
    private octokit: Octokit;
    public readonly org: string;
    public currentRepo: string = "";

    constructor() {
        this.octokit = new Octokit({ auth: e2eConfig.githubToken });
        this.org = e2eConfig.org;
    }

    async createTestRepo(): Promise<string> {
        const stack = new Error().stack || '';
        const stackLines = stack.split('\n');

        let testName = 'unknown';
        for (const line of stackLines) {
            if (line.includes('test/integration/')) {
                const match = line.match(/test\/integration\/([^.]+)\.test\.ts/);
                if (match) {
                    testName = match[1];
                    break;
                }
            }
        }

        const timestamp = Date.now();
        const repoName = `junie-test-${testName}-${timestamp}`;
        console.log(`Creating test repository: ${this.org}/${repoName}`);

        await this.octokit.repos.createInOrg({
            org: this.org,
            name: repoName,
            auto_init: true,
            private: true,
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
        let workflowContent = fs.readFileSync(workflowPath, "utf-8");
        const currentBranch = process.env.CURRENT_BRANCH || "v0";

        workflowContent = workflowContent.replace(/@v0/g, `@${currentBranch}`);
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

    async waitForJunieComment(issueOrPRNumber: number, message: string): Promise<Comment> {
        console.log(`Waiting for Junie to post comment containing "${message}" in issue #${issueOrPRNumber} in ${this.currentRepo}...`);
        let foundComment: Comment | undefined;
        await startPoll(
            `Junie didn't post comment containing "${message}" in issue #${issueOrPRNumber}`,
            {},
            async () => {
                const { data: comments } = await this.getAllIssueOrPRComments(issueOrPRNumber);
                const junieComment = comments.find(c => c.body?.includes(message));

                if (junieComment) {
                    foundComment = junieComment;
                    console.log(`Found comment with message: "${message}"`);
                    return true;
                }
                return false;
            }
        );
        return foundComment!;
    }

    async waitForCommentReaction(commentId: number, reactionType: string = "+1"): Promise<Reaction> {
        console.log(`Waiting for reaction "${reactionType}" on comment #${commentId} in ${this.currentRepo}...`);
        let foundReaction: Reaction | undefined;
        await startPoll(
            `Reaction "${reactionType}" not found on comment #${commentId}`,
            {},
            async () => {
                const { data: reactions } = await this.getAllCommentReactions(commentId);

                const hasReaction = reactions.some(r => r.content === reactionType);
                if (hasReaction) {
                    foundReaction = reactions.find(r => r.content === reactionType);
                    console.log(`Found "${reactionType}" reaction on comment #${commentId}`);
                    return true;
                }
                return false;
            }
        );
        return foundReaction!;
    }

    async waitForInlineComments(
        prNumber: number,
        condition: (comments: ReviewComment[]) => boolean | Promise<boolean>
    ): Promise<void> {
        console.log(`Waiting for condition in inline comment(s) on PR #${prNumber}...`);

        await startPoll(
            `Not enough inline comments found for PR #${prNumber}`,
            {},
            async () => {
                const { data: comments } = await this.getAllReviewComments(prNumber);

                if (condition(comments)) {
                    return true;
                }
                return false;
            }
        );
    }

    async waitForPR(
        condition: (pr: PullRequest) => boolean | Promise<boolean>
    ): Promise<PullRequest> {
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

        return foundPR!;
    }

    async checkInlineComments(
        prNumber: number,
        check: (comment: {
            commentText: string;
            codeLine: string;
        }) => boolean,
        minCount: number = 1
    ): Promise<void> {
        console.log(`Checking inline comments on PR #${prNumber}...`);

        await startPoll(
            `Inline comments don't match expectations for PR #${prNumber}`,
            {},
            async () => {
                const { data: comments } = await this.getAllReviewComments(prNumber);

                let matchCount = 0;
                for (const comment of comments) {
                    const diffLines = (comment.diff_hunk || "").split('\n');
                    const codeLine = diffLines[diffLines.length - 1] || "";

                    const result = check({
                        commentText: comment.body || "",
                        codeLine: codeLine
                    });

                    if (result) {
                        matchCount++;
                    }
                }
                console.log(`Found ${matchCount} matching inline comment(s) (required: ${minCount}).`);

                if (matchCount >= minCount) {
                    return true;
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

    async checkPRFiles(
        pr: PullRequest,
        condition: (files: GitHubFile[], pr: PullRequest) => boolean | Promise<boolean>
    ): Promise<boolean> {
        const { data: files } = await this.getAllPRFiles(pr);
        return condition(files, pr);
    }

    conditionPRFilesInclude(fileContentChecks: { [filename: string]: string }) {
        return async (files: GitHubFile[], pr: PullRequest) => {
            for (const [filename, expectedSnippet] of Object.entries(fileContentChecks)) {
                const file = files.find(f => f.filename.includes(filename));
                if (!file) {
                    console.log(`PR found but missing file for content check: ${filename}`);
                    return false;
                }

                const {data: contentData} = await this.getFileContent(pr.head.sha, file);

                if ("content" in contentData && typeof contentData.content === "string") {
                    const decodedContent = Buffer.from(contentData.content, "base64").toString("utf-8");
                    if (!decodedContent.includes(expectedSnippet)) {
                        console.log(`Content of ${file.filename} doesn't match expected snippet.`);
                        return false;
                    }
                }
            }
            return true;
        };
    }

    conditionPRNumberEquals(prNumber: number) {
        console.log(`Checking PR number is ${prNumber}`);
        return async (pr: PullRequest): Promise<boolean> => {
            return pr.number === prNumber;
        }
    }

    conditionPRFilesCountIncrease(filesCount: number) {
        return async (files: GitHubFile[]): Promise<boolean> => {
            return files.length > filesCount;
        }
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

    conditionCodeBeforeSuggestionIncludes(includesText: string) {
        return (comment: {
            commentText: string;
            codeLine: string;
        }): boolean => {
            return comment.codeLine.includes(includesText);
        }
    }

    conditionInlineCommentIncludes(includesText: string) {
        return (comment: {
            commentText: string;
            codeLine: string;
        }): boolean => {
            return comment.commentText.includes(includesText);
        }
    }

    conditionInlineCommentsAtLeast(minCount: number = 1) {
        return (comments: ReviewComment[]) => {
            console.log(`Found ${comments.length} inline comment(s) (required: ${minCount}).`);
            return comments.length >= minCount
        }
    }

    async getBranch(repoName: string) {
        return this.octokit.repos.getBranch({
            owner: this.org,
            repo: repoName,
            branch: "main",
        });
    }

    async createRef(repoName: string, branchName: string, sha: string) {
        return this.octokit.git.createRef({
            owner: this.org,
            repo: repoName,
            ref: `refs/heads/${branchName}`,
            sha: sha,
        });
    }

    async createPullRequest(repoName: string, branchName: string, title: string, body: string, base: string = "main") {
        return this.octokit.pulls.create({
            owner: this.org,
            repo: repoName,
            title: title,
            head: branchName,
            base: base,
            body: body,
        });
    }

    async createCommentToPROrIssue(repoName: string, issueOrPRNumber: number, commentBody: string) {
        return this.octokit.issues.createComment({
            owner: this.org,
            repo: repoName,
            issue_number: issueOrPRNumber,
            body: commentBody,
        });
    }

    private async getAllCommentReactions(commentId: number) {
        return this.octokit.reactions.listForIssueComment({
            owner: this.org,
            repo: this.currentRepo,
            comment_id: commentId,
        });
    }

    private async getAllReviewComments(prNumber: number){
        return this.octokit.pulls.listReviewComments({
            owner: this.org,
            repo: this.currentRepo,
            pull_number: prNumber,
        });
    }
}

export const testClient = new Client();
