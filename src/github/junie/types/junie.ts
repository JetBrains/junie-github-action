import {JunieExecutionContext} from "../../context";
import {Octokits} from "../../api/client";
import type {GitHubTokenConfig} from "../../token";


export type PrepareJunieOptions = {
    context: JunieExecutionContext;
    octokit: Octokits;
    tokenConfig: GitHubTokenConfig;
};

export interface MergeTask {
    branch: string;
}

export interface CodeReview {
    description?: string;
    diffCommand?: string;
}

export interface CliOutput {
    sessionId?: string;
    errors?: string[];
    taskName?: string;
    result?: string;
    duration_ms?: number;
    licenseType?: string;
}

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
    codeReviewTask?: CodeReview;
}