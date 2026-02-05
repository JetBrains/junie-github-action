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

export interface CodeReviewTask {
    diffPoint: string;
}

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
    CodeReviewTask?: CodeReviewTask;
}