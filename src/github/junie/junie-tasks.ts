import {
    isCodeReviewEvent,
    isFixCIEvent,
    isIssueCommentEvent,
    isIssuesEvent,
    isJiraWorkflowDispatchEvent,
    isMinorFixEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
    isPushEvent,
    isTriggeredByUserInteraction,
    isYouTrackWorkflowDispatchEvent,
    JunieExecutionContext
} from "../context";
import * as core from "@actions/core";
import * as fs from "node:fs";
import {BranchInfo} from "../operations/branch";
import {isReviewOrCommentHasResolveConflictsTrigger} from "../validation/trigger";
import {ENV_VARS, OUTPUT_VARS} from "../../constants/environment";
import {Octokits} from "../api/client";
import {NewGitHubPromptFormatter} from "./new-prompt-formatter";
import {GraphQLGitHubDataFetcher} from "../api/graphql-data-fetcher";
import {FetchedData} from "../api/queries";
import {CliInput} from "./types/junie";
import {generateMcpToolsPrompt} from "../../mcp/mcp-prompts";
import {junieArgsToString} from "../../utils/junie-args-parser";
import {
    addGitExcludePatterns,
    GENERATED_ARTIFACT_PATTERNS,
    isRunningInGitHubActions,
    PLAN_FILE_PATTERNS
} from "../../utils/git-exclude";

export function shouldRunInGoalMode(context: JunieExecutionContext): boolean {
    if (isMinorFixEvent(context)) {
        return false;
    }

    return (
        (isTriggeredByUserInteraction(context) && !isPushEvent(context)) ||
        isFixCIEvent(context) ||
        isJiraWorkflowDispatchEvent(context) ||
        isYouTrackWorkflowDispatchEvent(context) ||
        Boolean(context.inputs.prompt)
    );
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

const DO_NOT_COMMIT_PLAN_NOTE =
    "\n\nNote: do not commit any plan files to the repository. If you create a plan file, name it 'task-plan.md' but do not git add or commit it.";

/**
 * The final result of the run becomes the pull request description and the feedback comment,
 * so it has to stay as short as it was before goal mode. The orchestrated flow otherwise
 * reports every step in full and pastes what the tools printed (compiler help, logs, file
 * contents) straight into the summary.
 */
const SUMMARY_FORMAT_NOTE =
    "\n\nFinal summary format (the result is published as the pull request description):\n" +
    "- Keep it to a few sentences: what was changed and why, nothing else.\n" +
    "- Plain prose or a short bullet list only. No headings, no per-step report.\n" +
    "- Never paste code, diffs, file contents, command output, logs or tool help into it.";

/**
 * Goal mode runs an orchestrated flow that publishes the result on its own — pushing and
 * opening a pull request — which produces a second pull request next to the one the action
 * creates, on a branch the user's settings (`create_new_branch_for_pr`, `output_branch`, ...)
 * did not ask for.
 *
 * Only publishing is forbidden here. The local branch is deliberately not pinned: the
 * orchestrated flow checks out a branch of its own before the task even starts, and demanding
 * a specific one makes it report a conflict and do nothing at all. Whichever branch it ends up
 * on, `restoreWorkingBranch` in the results step moves the work onto the branch the action
 * prepared, so the user's settings still decide where the changes land.
 */
const PUBLISHING_POLICY_NOTE =
    "\n\nPublishing policy (must be followed exactly):\n" +
    "- Do NOT push anything to the remote and do NOT create or update a pull request.\n" +
    "- The action itself performs staging, committing, pushing and pull request creation once the task is done.\n" +
    "- Working locally on whatever branch the workflow has checked out is fine — just leave the changes committed or uncommitted there and finish the task.";

export async function prepareJunieTask(
    context: JunieExecutionContext,
    branchInfo: BranchInfo,
    octokit: Octokits,
    enabledMcpServers: string[] = [],
    isDefaultToken: boolean = false,
) {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const fetcher = new GraphQLGitHubDataFetcher(octokit);
    let junieCLITask: CliInput = {}
    let customJunieArgs: string[] = [];

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

        const promptResult = await formatter.generatePrompt(context, fetchedData, branchInfo, context.inputs.attachGithubContextToCustomPrompt, isDefaultToken);
        let promptText = promptResult.prompt;
        customJunieArgs = promptResult.customJunieArgs;

        // Log extracted custom junie args if any
        if (customJunieArgs.length > 0) {
            console.log(`Extracted custom junie args: ${customJunieArgs.join(' ')}`);
        }

        if (isRunningInGitHubActions()) {
            addGitExcludePatterns([...GENERATED_ARTIFACT_PATTERNS, ...PLAN_FILE_PATTERNS]);
        }

        // Append MCP tools information if any MCP servers are enabled
        const mcpToolsPrompt = generateMcpToolsPrompt(enabledMcpServers);
        if (mcpToolsPrompt) {
            promptText = promptText + mcpToolsPrompt;
        }

        // Note: Attachments are already processed in fetchIssueData/fetchPullRequestData
        if (isCodeReviewEvent(context)) {
            const diffPoint = branchInfo.prBaseBranch || branchInfo.baseBranch;
            const diffCommand = `git diff origin/${diffPoint}...`;
            junieCLITask.codeReviewTask = {
                description: promptText,
                diffCommand
            }
        } else if (shouldRunInGoalMode(context)) {
            junieCLITask.orchestratedTask = {
                task: promptText + PUBLISHING_POLICY_NOTE + DO_NOT_COMMIT_PLAN_NOTE + SUMMARY_FORMAT_NOTE
            };
        } else {
            junieCLITask.task = promptText;
        }
    }

    if (!junieCLITask.task && !junieCLITask.orchestratedTask && !junieCLITask.mergeTask && !junieCLITask.codeReviewTask) {
        throw new Error("No task was created. Please check your inputs.");
    }

    // Write task JSON to file to avoid ARG_MAX limit for large prompts
    const workingDir = process.env[ENV_VARS.WORKING_DIR];
    if (!workingDir) {
        throw new Error("WORKING_DIR environment variable is not set");
    }

    // Ensure working directory exists (recursive: true won't fail if dir already exists)
    fs.mkdirSync(workingDir, { recursive: true });

    const junieInputFile = `${workingDir}/junie_input.json`;
    fs.writeFileSync(junieInputFile, JSON.stringify(junieCLITask, null, 2));
    console.log(`Junie task written to file: ${junieInputFile}`);

    // Output file path (not content!) to avoid env variable size limits
    core.setOutput(OUTPUT_VARS.JUNIE_INPUT_FILE, junieInputFile);

    // Output custom junie args as a string for use in action.yml
    const customJunieArgsString = junieArgsToString(customJunieArgs);
    core.setOutput(OUTPUT_VARS.CUSTOM_JUNIE_ARGS, customJunieArgsString);

    return junieCLITask;
}
