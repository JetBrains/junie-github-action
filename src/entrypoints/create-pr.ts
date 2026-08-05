#!/usr/bin/env bun

import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import { JunieExecutionContext } from "../github/context";
import { ENV_VARS, OUTPUT_VARS } from "../constants/environment";
import { handleStepError } from "../utils/error-handler";
import { executeWithRetry } from "../utils/retry";

/**
 * Finds the open pull request that already uses `headBranch` as its head, if there is one.
 * Returns `undefined` when the lookup finds nothing or fails, so the original creation error
 * is the one reported.
 */
async function findOpenPullRequest(octokit: Octokit, owner: string, repo: string, headBranch: string) {
    try {
        const {data: pullRequests} = await octokit.rest.pulls.list({
            owner,
            repo,
            state: "open",
            head: `${owner}:${headBranch}`,
        });

        return pullRequests[0];
    } catch (lookupError) {
        console.error(`Failed to look up an existing PR for ${headBranch}:`, lookupError);
        return undefined;
    }
}

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

        let pr;
        try {
            // Create PR with
            pr = (await executeWithRetry(
                () => octokit.rest.pulls.create({
                    owner,
                    repo,
                    title: prTitle,
                    body: prBody,
                    head: headBranch,
                    base: baseBranch,
                }),
                'Create Pull Request'
            )).data;

            console.log(`Successfully created PR #${pr.number}: ${pr.html_url}`);
        } catch (error: any) {
            // GitHub allows one pull request per head branch, so creation fails with 422 when
            // something opened it first — most often Junie itself, whose goal mode flow publishes
            // the result on its own. Adopting that pull request keeps the run to a single one and
            // still reports a link, instead of falling back to "create a PR manually".
            const existingPr = error.status === 422
                ? await findOpenPullRequest(octokit, owner, repo, headBranch)
                : undefined;

            if (!existingPr) {
                throw error;
            }

            console.log(`PR #${existingPr.number} already exists for ${headBranch}, updating it instead`);
            pr = (await executeWithRetry(
                () => octokit.rest.pulls.update({
                    owner,
                    repo,
                    pull_number: existingPr.number,
                    title: prTitle,
                    body: prBody,
                }),
                'Update Pull Request'
            )).data;
        }

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
