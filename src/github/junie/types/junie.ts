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

export interface RemoteRequestReviewTarget {
    type: "remoteRequest";
    number: number;
}

export type ReviewTarget = RemoteRequestReviewTarget;

export function remoteRequestReviewTarget(prNumber: number): RemoteRequestReviewTarget {
    return {type: "remoteRequest", number: prNumber};
}

export interface CodeReview {
    description?: string;
    diffCommand?: string;
    fetchVcsInfo?: boolean;
    reviewTarget?: ReviewTarget;
}

export interface CliOutput {
    sessionId?: string;
    errors?: string[];
    taskName?: string;
    result?: string;
    duration_ms?: number;
}

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
    codeReviewTask?: CodeReview;
}