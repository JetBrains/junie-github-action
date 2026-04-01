import {JunieExecutionContext} from "../context";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../../constants/environment";

export async function prepareJunieCLIToken(context: JunieExecutionContext) {
    const token = context.inputs.appToken
    const hasExternalAiKey = (context.inputs.openaiApiKey && context.inputs.openaiApiKey.trim().length > 0) ||
                             (context.inputs.anthropicApiKey && context.inputs.anthropicApiKey.trim().length > 0);

    if (!token || token.trim().length === 0) {
        if (hasExternalAiKey) {
            console.log("No JUNIE API KEY provided, but external AI key is present. Skipping CLI token preparation.");
            return;
        }
        throw new Error("Missing required input: JUNIE API KEY (required if no external AI key is provided)");
    }

    core.setSecret(context.inputs.appToken);
    core.setOutput(OUTPUT_VARS.EJ_CLI_TOKEN, context.inputs.appToken);
}