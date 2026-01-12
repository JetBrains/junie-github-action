import {
    JunieExecutionContext,
    isIssueCommentEvent,
    isIssuesEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent
} from "../context";
import * as core from "@actions/core";
import {BranchInfo} from "../operations/branch";
import {isReviewOrCommentHasResolveConflictsTrigger} from "../validation/trigger";
import {OUTPUT_VARS} from "../../constants/environment";
import {DEFAULT_CODE_REVIEW_PROMPT} from "../../constants/github";
import {Octokits} from "../api/client";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {validateInputSize} from "../validation/input-size";
import {downloadAttachmentsAndRewriteText} from "./attachment-downloader";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";
import {FetchedData} from "../api/queries";
import {CliInput} from "./types/junie";

async function getValidatedTextTask(text: string, taskType: string): Promise<string> {
    // Download attachments and rewrite URLs in the text
    const textWithLocalAttachments = await downloadAttachmentsAndRewriteText(text);
    validateInputSize(textWithLocalAttachments, taskType);
    return textWithLocalAttachments
}

function getTriggerTime(context: JunieExecutionContext): string | undefined {
    if (isIssueCommentEvent(context)) {
        return context.payload.comment.created_at;
    } else if (isIssuesEvent(context)) {
        return context.payload.issue.updated_at;
    } else if (isPullRequestReviewEvent(context)) {
        return context.payload.review.submitted_at || undefined;
    } else if (isPullRequestReviewCommentEvent(context)) {
        return context.payload.comment.created_at;
    } else if (isPullRequestEvent(context)) {
        return context.payload.pull_request.updated_at;
    }
    return undefined;
}

export async function prepareJunieTask(
    context: JunieExecutionContext,
    branchInfo: BranchInfo,
    octokit: Octokits
) {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    const customPrompt = context.inputs.prompt || undefined;
    let junieCLITask: CliInput = {}

    if (context.inputs.resolveConflicts || isReviewOrCommentHasResolveConflictsTrigger(context)) {
        junieCLITask.mergeTask = {branch: branchInfo.prBaseBranch || branchInfo.baseBranch}
    } else {
        const formatter = new NewGitHubPromptFormatter();
        let fetchedData: FetchedData = {};
        const triggerTime = getTriggerTime(context);

        // Fetch appropriate data
        if (context.isPR && context.entityNumber) {
            fetchedData = await fetcher.fetchPullRequestData(owner, repo, context.entityNumber, triggerTime);
        } else if (context.entityNumber) {
            fetchedData = await fetcher.fetchIssueData(owner, repo, context.entityNumber, triggerTime);
        }

        const issue = fetchedData.pullRequest || fetchedData.issue;

        const isCodeReview = isPullRequestReviewEvent(context) || isPullRequestReviewCommentEvent(context);

        if (issue && isCodeReview) {
            // For code reviews, we use the issueTask (agent)
            // We use the hardcoded prompt from inputs, or a default one.
            // We ignore the comment/review body as instructions.
            const instructions = context.inputs.prompt || DEFAULT_CODE_REVIEW_PROMPT;
            const validatedInstructions = await getValidatedTextTask(instructions, "task");

            junieCLITask.issueTask = {
                issue,
                owner,
                repo,
                instructions: validatedInstructions,
                targetBranch: branchInfo.workingBranch,
                baseBranch: branchInfo.baseBranch,
                bannedTools: [
                    "apply_patch",
                    "search_replace",
                    "create_file",
                    "rename_element",
                    "undo_edit",
                    "bash",
                    "run_test",
                    "build",
                    "submit"
                ]
            };
        } else {
            // Fallback to legacy task string for other events (like issue_comment "fix this")
            const promptText = await formatter.generatePrompt(context, fetchedData, customPrompt, context.inputs.attachGithubContextToCustomPrompt);
            junieCLITask.task = await getValidatedTextTask(promptText, "task");
        }
    }

    if (!junieCLITask.task && !junieCLITask.mergeTask && !junieCLITask.issueTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    core.setOutput(OUTPUT_VARS.JUNIE_JSON_TASK, JSON.stringify(junieCLITask));

    return junieCLITask;
}
