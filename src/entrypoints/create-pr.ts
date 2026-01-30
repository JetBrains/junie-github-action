#!/usr/bin/env bun

import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import { JunieExecutionContext } from "../github/context";
import { ENV_VARS, OUTPUT_VARS } from "../constants/environment";
import { handleStepError } from "../utils/error-handler";
import { executeWithRetry } from "../utils/retry";

export async function createPullRequest() {
    try {
        const githubToken = process.env[ENV_VARS.GITHUB_TOKEN]!;
        const context = JSON.parse(process.env[OUTPUT_VARS.PARSED_CONTEXT]!) as JunieExecutionContext;
        const prTitle = process.env[OUTPUT_VARS.PR_TITLE]!;
        const prBody = process.env[OUTPUT_VARS.PR_BODY]!;
        const baseBranch = process.env[OUTPUT_VARS.BASE_BRANCH]!;
        const headBranch = process.env[OUTPUT_VARS.WORKING_BRANCH]!;

        console.log(`Creating PR from ${headBranch} to ${baseBranch}`);
        console.log(`PR Title: ${prTitle}`);

        const octokit = new Octokit({
            auth: githubToken,
        });

        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        // Create PR with
        const { data: pr } = await executeWithRetry(
            () => octokit.rest.pulls.create({
                owner,
                repo,
                title: prTitle,
                body: prBody,
                head: headBranch,
                base: baseBranch,
            }),
            'Create Pull Request'
        );

        console.log(`Successfully created PR #${pr.number}: ${pr.html_url}`);
        core.setOutput("pull-request-url", pr.html_url);
    } catch (error: any) {
        // Enhanced error logging for GitHub API errors
        if (error.status) {
            console.error(`GitHub API Error: ${error.status} - ${error.message}`);
            if (error.response?.data) {
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
        }
        handleStepError("Create PR step", error);
    }
}

// @ts-ignore
if (import.meta.main) {
    createPullRequest();
}
