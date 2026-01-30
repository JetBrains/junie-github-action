#!/usr/bin/env bun

import * as core from "@actions/core";
import {OUTPUT_VARS} from "../constants/environment";

/**
 * Handles errors in entrypoint scripts by:
 * - Extracting error message
 * - Setting step as failed in GitHub Actions
 * - Setting exception output for downstream steps
 * - Exiting with error code
 *
 * @param stepName - Name of the step for error message (e.g., "Prepare step")
 * @param error - The caught error
 */
export function handleStepError(stepName: string, error: unknown): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${stepName} failed with error: ${errorMessage}`);
    core.setFailed(`${stepName} failed with error: ${errorMessage}`);
    core.setOutput(OUTPUT_VARS.EXCEPTION, errorMessage);
    process.exit(1);
}
