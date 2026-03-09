import {JunieExecutionContext} from "../context";
import * as core from "@actions/core";
import {OUTPUT_VARS} from "../../constants/environment";

export async function prepareJunieCLIToken(context: JunieExecutionContext) {
    const { appToken, openaiApiKey, anthropicApiKey, grokApiKey, openrouterApiKey, googleApiKey } = context.inputs;

    const hasByokKey = openaiApiKey || anthropicApiKey || grokApiKey || openrouterApiKey || googleApiKey;

    if (!appToken && !hasByokKey) {
        throw new Error("Missing required input: provide either junie_api_key or a BYOK key (openai_api_key, anthropic_api_key, grok_api_key, openrouter_api_key, or google_api_key)");
    }

    if (appToken) {
        if (appToken.trim().length === 0) {
            throw new Error("Invalid JUNIE API KEY");
        }
        core.setSecret(appToken);
        core.setOutput(OUTPUT_VARS.EJ_CLI_TOKEN, appToken);
    }

    // Mask BYOK keys so they don't appear in logs
    if (openaiApiKey) core.setSecret(openaiApiKey);
    if (anthropicApiKey) core.setSecret(anthropicApiKey);
    if (grokApiKey) core.setSecret(grokApiKey);
    if (openrouterApiKey) core.setSecret(openrouterApiKey);
    if (googleApiKey) core.setSecret(googleApiKey);
}