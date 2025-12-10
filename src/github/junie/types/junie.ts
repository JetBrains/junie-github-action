import {GitHubContext} from "../../context";
import {Octokits} from "../../api/client";
import type {GitHubTokenConfig} from "../../token";


export type PrepareJunieOptions = {
    context: GitHubContext;
    octokit: Octokits;
    tokenConfig: GitHubTokenConfig;
};

export interface MergeTask {
    branch: string;
}

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
}