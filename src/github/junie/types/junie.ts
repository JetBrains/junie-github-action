import {JunieExecutionContext} from "../../context";
import {Octokits} from "../../api/client";
import type {GitHubTokenConfig} from "../../token";
import {GraphQLIssue, GraphQLPullRequest} from "../../api/queries";


export type PrepareJunieOptions = {
    context: JunieExecutionContext;
    octokit: Octokits;
    tokenConfig: GitHubTokenConfig;
};

export interface MergeTask {
    branch: string;
}

export interface IssueTask {
    issue: GraphQLIssue | GraphQLPullRequest;
    owner: string;
    repo: string;
    instructions?: string;
    targetBranch?: string;
    baseBranch?: string;
    bannedTools?: string[];
}

export interface CliInput {
    task?: string;
    mergeTask?: MergeTask;
    issueTask?: IssueTask;
}