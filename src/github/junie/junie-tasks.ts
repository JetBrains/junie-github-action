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

function shouldRunInGoalMode(context: JunieExecutionContext): boolean {
    if (isMinorFixEvent(context)) {
        return false;
    }

    return (
        isTriggeredByUserInteraction(context) ||
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
            junieCLITask.orchestratedTask = {task: promptText + DO_NOT_COMMIT_PLAN_NOTE};
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
