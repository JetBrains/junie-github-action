import {GitHubContext} from "../context";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../../constants/environment";

export async function prepareJunieCLIToken(context: GitHubContext) {
    const token = context.inputs.appToken
    if (!token || token.trim().length === 0) {
        throw new Error("Missing required input: JUNIE_API_TOKEN");
    }
    core.setSecret(context.inputs.appToken);
    core.setOutput(OUTPUT_VARS.EJ_CLI_TOKEN, context.inputs.appToken);
}