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
    JiraIssuePayload,
    JunieExecutionContext,
    YouTrackIssuePayload
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
import {addGitExcludePatterns, AGENT_ARTIFACT_PATTERNS} from "../../utils/git-exclude";

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

const PUBLISHING_POLICY_NOTE =
    "\n\nPublishing policy (must be followed exactly):\n" +
    "- Do NOT push to the remote, and do NOT create or update a pull request. The workflow " +
    "stages, commits, pushes and opens the pull request itself once the task is done.\n" +
    "- If this run targets an existing pull request, its title, description, labels, reviewers " +
    "and every other field must be left exactly as they are. Do NOT rename, retitle, reword or " +
    "otherwise edit the pull request: only the code changes are yours to make, and the workflow " +
    "adds your summary on its own.\n" +
    "- Do NOT create git worktrees. Work in the checkout you were given and leave the changes there.";

function buildBranchPolicyNote(branchInfo: BranchInfo, context: JunieExecutionContext): string {
    const branch = branchInfo.workingBranch;

    const stayPut =
        "\n\nBranch policy (must be followed exactly):\n" +
        `- Branch '${branch}' is checked out and is the only place your changes belong. Commit them ` +
        "there. Do NOT create, switch to or rename a branch.\n";

    if (branchInfo.isNewBranch) {
        return stayPut +
            `- The workflow created '${branch}' for this run and opens a new pull request from it once ` +
            "you finish. Do NOT open that pull request yourself.";
    }

    if (context.isPR) {
        return stayPut +
            `- '${branch}' is the branch of the pull request this run targets. The workflow pushes your ` +
            "commits straight onto it, so do NOT open a new pull request under any circumstances.";
    }

    return stayPut +
        "- The workflow decides what to publish once you finish. Do NOT open a pull request.";
}

const PLAN_ARTIFACT_NOTE =
    "\n\nDo not stage or commit your plan file or any other scratch file you create while " +
    "working. Only the actual code changes the task calls for belong in the commit.";

const SUMMARY_FORMAT_NOTE =
    "\n\nFinal summary format (it is published as the pull request description):\n" +
    "- A few sentences: what changed and why, nothing else.\n" +
    "- Plain prose or a short bullet list. No headings, no per-step report.\n" +
    "- Never paste code, diffs, file contents, command output or logs into it.";

const TITLE_FORMAT_NOTE =
    "\n\nTask name (the workflow titles the pull request from the issue or pull request that " +
    "triggered this run; your name is used only when there is no such issue or pull request, " +
    "so it still has to read like a title):\n" +
    "- It names the CHANGE, not your work on it. Whenever you report a task name — at any " +
    "point, from any step or sub-agent — give the name of the overall change this run delivers. " +
    "Never name the step you just finished, the step you are in, or the stage of your own " +
    "process. The reviewer sees only this one line and knows nothing about how you work.\n" +
    "- Write what a developer would put on the pull request: the change or the business value " +
    "it delivers, e.g. 'Add export functionality to users module' or " +
    "'Fix NPE in payment processing'.\n" +
    "- One short line, no trailing period.\n" +
    "- Banned outright. The title must never contain 'Step', 'Stage', 'Review', " +
    "'Implementation', 'Validation', 'Validation Completeness', 'Deliverables', " +
    "'Task execution', 'Orchestrated', 'Final report', or any other word describing your " +
    "internal process rather than the code. 'Review Step 1 Implementation and Validation " +
    "Completeness' is exactly the kind of title that must never be produced.\n" +
    "- Do NOT prefix it with '[Junie]:' yourself: the workflow adds that.";

function getExternalTrackerTitle(context: JunieExecutionContext): string | undefined {
    if (isJiraWorkflowDispatchEvent(context)) {
        return (context.payload as JiraIssuePayload).issueSummary;
    }
    if (isYouTrackWorkflowDispatchEvent(context)) {
        return (context.payload as YouTrackIssuePayload).issueTitle;
    }
    return undefined;
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

        // Resolved here (where the entity is already fetched) for the results step to title the PR.
        const entityTitle = fetchedData.pullRequest?.title
            || fetchedData.issue?.title
            || getExternalTrackerTitle(context);
        if (entityTitle) {
            core.setOutput(OUTPUT_VARS.ENTITY_TITLE, entityTitle);
        }

        const promptResult = await formatter.generatePrompt(context, fetchedData, branchInfo, context.inputs.attachGithubContextToCustomPrompt, isDefaultToken);
        let promptText = promptResult.prompt;
        customJunieArgs = promptResult.customJunieArgs;

        // Log extracted custom junie args if any
        if (customJunieArgs.length > 0) {
            console.log(`Extracted custom junie args: ${customJunieArgs.join(' ')}`);
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
            console.log("Running this task in goal mode (orchestrated)");

            // Keep the agent's own artifacts out of the commit the action builds later.
            addGitExcludePatterns(AGENT_ARTIFACT_PATTERNS);

            junieCLITask.orchestratedTask = {
                task: promptText + PUBLISHING_POLICY_NOTE + buildBranchPolicyNote(branchInfo, context) +
                    PLAN_ARTIFACT_NOTE + SUMMARY_FORMAT_NOTE + TITLE_FORMAT_NOTE
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
