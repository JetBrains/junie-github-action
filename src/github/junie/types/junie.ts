import {GitHubContext} from "../../context";
import {Octokits} from "../../api/client";
import type {GitHubTokenConfig} from "../../token";


export interface JunieTask {
    mergeTask?: MergeTask | null;
    textTask?: TextTask | null;
}

export interface MergeTask {
    branch: string, // ref: branch, sha or tag
    type: string, // rebase or merge
}

export interface TextTask {
    text: string;
}


export type PrepareJunieOptions = {
    context: GitHubContext;
    octokit: Octokits;
    tokenConfig: GitHubTokenConfig;
};