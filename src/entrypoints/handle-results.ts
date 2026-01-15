import {COMMIT_MESSAGE_TEMPLATE, PR_BODY_TEMPLATE, PR_TITLE_TEMPLATE} from "../constants/github";
import {JunieExecutionContext, isTriggeredByUserInteraction, isJiraWorkflowDispatchEvent} from "../github/context";
import {execSync} from 'child_process';
import * as core from "@actions/core";
import {ENV_VARS, OUTPUT_VARS} from "../constants/environment";
import {handleStepError} from "../utils/error-handler";
import {isReviewOrCommentHasResolveConflictsTrigger} from "../github/validation/trigger";

export enum ActionType {
    WRITE_COMMENT = 'WRITE_COMMENT',
    CREATE_PR = 'CREATE_PR',
    COMMIT_CHANGES = 'COMMIT_CHANGES',
    PUSH = 'PUSH',
    NOTHING = 'NOTHING'
}

export async function handleResults() {
    try {
        const stringJunieJsonOutput = process.env[ENV_VARS.JSON_JUNIE_OUTPUT]
        console.log(`[DEBUG] handleResults: JSON_JUNIE_OUTPUT length: ${stringJunieJsonOutput?.length || 0}`);
        if (!stringJunieJsonOutput) {
            throw new Error(
                `❌ Failed to retrieve Junie execution results. ` +
                `This could be due to:\n` +
                `• Junie execution did not complete successfully\n` +
                `• Junie output was empty or invalid\n` +
                `Please check the Junie execution logs for details.`
            );
        }
        const junieJsonOutput = JSON.parse(stringJunieJsonOutput) as any
        const context = JSON.parse(process.env[OUTPUT_VARS.PARSED_CONTEXT]!) as JunieExecutionContext
        const isResolveConflict = context.inputs.resolveConflicts || isReviewOrCommentHasResolveConflictsTrigger(context)
        const junieErrors = junieJsonOutput.errors
        if (junieErrors && (junieErrors as string[]).length > 0) {
            const errorList = (junieErrors as string[]).map(err => `  • ${err}`).join('\n');
            throw new Error(
                `❌ Junie execution encountered errors during task processing.\n\n` +
                `Errors reported:\n${errorList}\n\n` +
                `Review the errors above and check the Junie execution logs for more details.`
            );
        }
        const actionToDo = await getActionToDo(context);
        const title = junieJsonOutput.taskName || (isResolveConflict ? `Resolve conflicts for ${context.entityNumber} PR` : 'Junie finished task successfully')
        const body = junieJsonOutput.result
        let issueId
        if (isTriggeredByUserInteraction(context)) {
            issueId = context.entityNumber
        }
        const commitMessage = COMMIT_MESSAGE_TEMPLATE(title, issueId)

        // Export outputs based on action type
        switch (actionToDo) {
            case ActionType.CREATE_PR:
                exportResultsOutputs(
                    title,
                    body,
                    commitMessage,
                    PR_TITLE_TEMPLATE(title),
                    PR_BODY_TEMPLATE(body, issueId));
                break;
            case ActionType.COMMIT_CHANGES:
            case ActionType.PUSH:
                exportResultsOutputs(title, body, commitMessage);
                break;
            case ActionType.WRITE_COMMENT:
            case ActionType.NOTHING:
                exportResultsOutputs(title, body);
                break;
        }
    } catch (error) {
        handleStepError("Handle results step", error);
    }
}

async function getActionToDo(context: JunieExecutionContext): Promise<ActionType> {
    if (context.inputs.silentMode) {
        console.log('Silent mode enabled - no git operations will be performed');
        return ActionType.NOTHING;
    }
    const isNewBranch = process.env[OUTPUT_VARS.IS_NEW_BRANCH] === 'true';
    const workingBranch = process.env[OUTPUT_VARS.WORKING_BRANCH]!;
    const baseBranch = process.env[OUTPUT_VARS.BASE_BRANCH]!;
    const hasChangedFiles = await checkForChangedFiles();
    const hasUnpushedCommits = await checkForUnpushedCommits(isNewBranch, baseBranch);
    const isExternalIntegration = isJiraWorkflowDispatchEvent(context)
    const initCommentId = process.env[OUTPUT_VARS.INIT_COMMENT_ID];

    console.log(`Has changed files: ${hasChangedFiles}`);
    console.log(`Has unpushed commits: ${hasUnpushedCommits}`);
    console.log(`Init comment ID: ${initCommentId}`);
    console.log(`Is new branch: ${isNewBranch}`);
    console.log(`Is external integration: ${isExternalIntegration}`)
    console.log(`Working branch: ${workingBranch}`);

    let action: ActionType
    if ((hasChangedFiles || hasUnpushedCommits) && isNewBranch) {
        console.log('Changes or unpushed commits found in new branch - will create PR');
        action = ActionType.CREATE_PR;
    } else if (hasChangedFiles && !isNewBranch) {
        console.log('Changes found and working in existing branch - will commit directly');
        action = ActionType.COMMIT_CHANGES;
    } else if (hasUnpushedCommits) {
        console.log('No changes but has unpushed commits in existing branch - will push');
        action = ActionType.PUSH;
    } else if (initCommentId || isExternalIntegration) {
        console.log('No changes and no unpushed commits but has comment ID or it`s an external integration - will write comment');
        action = ActionType.WRITE_COMMENT;
    } else {
        console.log('No specific action matched - do nothing');
        action = ActionType.NOTHING;
    }

    console.log("Action to do:", action);
    core.setOutput(OUTPUT_VARS.ACTION_TO_DO, action);
    return action;
}

async function checkForChangedFiles(): Promise<boolean> {
    try {
        console.log('Checking for changed files...');
        // Check for staged and unstaged changes
        const gitStatus = execSync('git status --porcelain', {encoding: 'utf-8'});

        console.log('Changed files:', gitStatus);
        // If git status returns any output, there are changes
        return gitStatus.trim().length > 0;
    } catch (error) {
        console.error('Error checking for changed files:', error);
        // If we can't check, assume there are no changes to be safe
        return false;
    }
}

async function checkForUnpushedCommits(isNewBranch: boolean, baseBranch: string): Promise<boolean> {
    try {
        console.log('Checking for unpushed commits...');

        if (isNewBranch) {
            // For a new branch, compare with the remote base branch
            const unpushedCommits = execSync(`git log origin/${baseBranch}..HEAD --oneline`, {encoding: 'utf-8'});
            console.log(`Commits ahead of origin/${baseBranch}:`, unpushedCommits);

            return unpushedCommits.trim().length > 0;
        } else {
            execSync('git rev-parse --abbrev-ref @{u}', {encoding: 'utf-8', stdio: 'pipe'});
            // Upstream exists, compare with it
            const unpushedCommits = execSync('git log @{u}..HEAD --oneline', {encoding: 'utf-8'});
            console.log('Unpushed commits:', unpushedCommits);
            return unpushedCommits.trim().length > 0;
        }
    } catch (error) {
        console.error('Error checking for unpushed commits:', error);
        // If we can't check at all, assume there are no unpushed commits
        return false;
    }
}

function exportResultsOutputs(junieTitle: string,
                              junieSummary: string,
                              commitMessage?: string,
                              prTitle?: string,
                              prBody?: string): void {
    core.setOutput(OUTPUT_VARS.JUNIE_TITLE, junieTitle);
    core.setOutput(OUTPUT_VARS.JUNIE_SUMMARY, junieSummary);

    if (commitMessage) {
        core.setOutput(OUTPUT_VARS.COMMIT_MESSAGE, commitMessage);
    }

    if (prTitle && prBody) {
        core.setOutput(OUTPUT_VARS.PR_TITLE, prTitle);
        core.setOutput(OUTPUT_VARS.PR_BODY, prBody);
    }
}


// @ts-ignore
if (import.meta.main) {
    handleResults();
}