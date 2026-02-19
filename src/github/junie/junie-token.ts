import {JunieExecutionContext} from "../context";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../../constants/environment";

export async function prepareJunieCLIToken(context: JunieExecutionContext) {
    const token = context.inputs.appToken
    if (!token) {
        throw new Error("Missing required input: JUNIE API KEY");
    }
    if (token.trim().length === 0) {
        throw new Error("Invalid JUNIE API KEY");
    }
    core.setSecret(context.inputs.appToken);
    core.setOutput(OUTPUT_VARS.EJ_CLI_TOKEN, context.inputs.appToken);
}