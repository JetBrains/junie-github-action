#!/usr/bin/env bun

import {buildGitHubApiClient} from '../github/api/client';
import {JunieExecutionContext} from '../github/context';
import {runAutoCollectFeedback} from '../github/operations/feedback/auto-collect/orchestrator';
import {ENV_VARS, OUTPUT_VARS} from '../constants/environment';
import {handleStepError} from '../utils/error-handler';

async function run() {
    try {
        const rawContext = process.env[OUTPUT_VARS.PARSED_CONTEXT];
        if (!rawContext) {
            throw new Error(`Missing environment variable: ${OUTPUT_VARS.PARSED_CONTEXT}`);
        }
        const context = JSON.parse(rawContext) as JunieExecutionContext;

        const githubToken = process.env[OUTPUT_VARS.EJ_AUTH_GITHUB_TOKEN] || process.env[ENV_VARS.GITHUB_TOKEN];
        if (!githubToken) {
            throw new Error('Missing GitHub token for auto-collect feedback');
        }

        if (!context.isPR || !context.entityNumber) {
            console.log('Auto-collect feedback requires a pull request context - skipping');
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
        });

        const submitted = outcomes.filter((o) => o.status === 'submitted').length;
        console.log(`Auto-collect finished: ${submitted} submitted, ${outcomes.length} total`);
    } catch (error) {
        handleStepError('Auto-collect feedback step', error);
    }
}

// @ts-ignore
if (import.meta.main) {
    run();
}
