import {postJunieCompletionComment} from "../github/operations/comments/feedback";
import type {FinishFeedbackData} from "../github/operations/comments/types";
import {JunieExecutionContext} from "../github/context";
import {ActionType} from "./handle-results";
import {ENV_VARS, OUTPUT_VARS} from "../constants/environment";
import {formatJunieSummary} from "./format-summary";
import {appendFileSync} from "fs";
import {buildGitHubApiClient} from "../github/api/client";
import {handleStepError} from "../utils/error-handler";

/**
 * Writes feedback comment to GitHub issue/PR if initCommentId is available
 */
async function writeFeedbackComment(isJobFailed: boolean, initCommentId?: string): Promise<void> {
    const data: FinishFeedbackData = {
        initCommentId: initCommentId,
        isJobFailed: isJobFailed,
        parsedContext: JSON.parse(process.env[OUTPUT_VARS.PARSED_CONTEXT]!) as JunieExecutionContext
    }

    if (data.isJobFailed) {
        data.failureData = {error: process.env[ENV_VARS.ERROR]}
    } else {
        data.successData = {
            actionToDo: process.env[OUTPUT_VARS.ACTION_TO_DO] as keyof typeof ActionType,
            baseBranch: process.env[OUTPUT_VARS.BASE_BRANCH],
            commitSHA: process.env[ENV_VARS.COMMIT_SHA],
            junieSummary: process.env[OUTPUT_VARS.JUNIE_SUMMARY],
            junieTitle: process.env[OUTPUT_VARS.JUNIE_TITLE],
            prLink: process.env[ENV_VARS.PR_LINK],
            workingBranch: process.env[OUTPUT_VARS.WORKING_BRANCH]
        }
    }

    const octokits = buildGitHubApiClient(process.env[ENV_VARS.GITHUB_TOKEN]!);
    await postJunieCompletionComment(octokits.rest, data)
}

/**
 * Generates GitHub Actions Job Summary with Junie execution results
 */
async function generateJobSummary(isJobFailed: boolean): Promise<void> {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) {
        console.log("GITHUB_STEP_SUMMARY not available, skipping summary generation");
        return;
    }

    // Build junieOutput from already parsed env variables
    const junieOutput: any = {};

    if (isJobFailed) {
        // For failed jobs, add error message
        const errorMessage = process.env[ENV_VARS.ERROR];
        if (errorMessage) {
            junieOutput.error = errorMessage;
        }
    } else {
        // For successful jobs, use already parsed values
        junieOutput.title = process.env[OUTPUT_VARS.JUNIE_TITLE];
        junieOutput.summary = process.env[OUTPUT_VARS.JUNIE_SUMMARY];
    }

    // Try to get duration_ms from JSON_JUNIE_OUTPUT if available
    const jsonOutput = process.env[ENV_VARS.JSON_JUNIE_OUTPUT];
    if (jsonOutput) {
        try {
            const parsed = JSON.parse(jsonOutput);
            if (parsed.duration_ms) {
                junieOutput.duration_ms = parsed.duration_ms;
            }
        } catch (parseError) {
            // Ignore parse errors, we have the main data from env vars
        }
    }

    const markdown = formatJunieSummary(
        junieOutput,
        process.env[OUTPUT_VARS.ACTION_TO_DO],
        process.env[ENV_VARS.COMMIT_SHA],
        process.env[ENV_VARS.PR_LINK],
        process.env[OUTPUT_VARS.WORKING_BRANCH]
    );

    appendFileSync(summaryFile, markdown);
    console.log("✓ Successfully generated Junie summary");
}

export async function giveFeedback() {
    try {
        const isJobFailed = process.env[ENV_VARS.IS_JOB_FAILED] === "true";
        const initCommentId = process.env[OUTPUT_VARS.INIT_COMMENT_ID];

        await writeFeedbackComment(isJobFailed, initCommentId);

        // Generate GitHub Actions Job Summary (always)
        try {
            await generateJobSummary(isJobFailed);
        } catch (summaryError) {
            console.error("Failed to generate job summary:", summaryError);
            // Don't fail the whole step if summary generation fails
        }
    } catch (error) {
        handleStepError("Give feedback step", error);
    }
}

// @ts-ignore
if (import.meta.main) {
    giveFeedback();
}