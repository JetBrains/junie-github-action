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

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
    codeReview?: CodeReview;
}