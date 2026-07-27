#!/usr/bin/env bun

import * as core from '@actions/core';
import {buildGitHubApiClient} from '../github/api/client';
import {JunieExecutionContext} from '../github/context';
import {runAutoCollectFeedback} from '../github/operations/feedback/auto-collect/orchestrator';
import {ENV_VARS, OUTPUT_VARS} from '../constants/environment';
import {handleStepError} from '../utils/error-handler';

async function run() {
    try {
        const context = JSON.parse(process.env[OUTPUT_VARS.PARSED_CONTEXT]!) as JunieExecutionContext;
        const githubToken = process.env[OUTPUT_VARS.EJ_AUTH_GITHUB_TOKEN] || process.env[ENV_VARS.GITHUB_TOKEN];
        if (!githubToken) {
            throw new Error('Missing GitHub token for auto-collect feedback');
        }

        if (!context.isPR || !context.entityNumber) {
            console.log('Auto-collect feedback requires a pull request context — skipping');
            return;
        }

        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const workingDir = process.env[ENV_VARS.WORKING_DIR] || '/tmp/junie-work';
        const octokit = buildGitHubApiClient(githubToken);

        // JUNIE_FLAGS is assembled by src/scripts/build-junie-flags.sh (same as Run Junie).
        const outcomes = await runAutoCollectFeedback({
            octokit: octokit.rest,
            owner,
            repo,
            prNumber: context.entityNumber,
            apiBaseUrl: process.env[ENV_VARS.CODE_REVIEW_FEEDBACK_API_BASE_URL],
            workingDir,
            cliToken: process.env[OUTPUT_VARS.EJ_CLI_TOKEN] || process.env[ENV_VARS.APP_TOKEN],
            junieFlags: process.env.JUNIE_FLAGS || '',
            enableAgent: process.env.AUTO_COLLECT_ENABLE_AGENT !== 'false',
            dryRun: process.env[ENV_VARS.AUTO_COLLECT_FEEDBACK_DRY_RUN] === 'true',
        });

        const submitted = outcomes.filter((o) => o.status === 'submitted').length;
        const dryRunCount = outcomes.filter((o) => o.status === 'dry_run').length;
        core.setOutput('AUTO_COLLECT_SUBMITTED_COUNT', String(submitted));
        core.setOutput('AUTO_COLLECT_DRY_RUN_COUNT', String(dryRunCount));
        core.setOutput('AUTO_COLLECT_OUTCOMES', JSON.stringify(outcomes));
        console.log(
            `Auto-collect finished: ${submitted} submitted, ${dryRunCount} dry-run, ${outcomes.length} total`,
        );
    } catch (error) {
        handleStepError('Auto-collect feedback step', error);
    }
}

// @ts-ignore
if (import.meta.main) {
    run();
}
