import { testClient } from "../client/client";

export async function startPoll(
    errorMessage: string,
    options: {
        pollIntervalMs?: number;
        timeoutMs?: number;
    },
    call: () => Promise<boolean> | boolean
): Promise<void> {
    const { pollIntervalMs = 30000, timeoutMs = 12 * 60 * 1000 } = options;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await call()) return;
        await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`${errorMessage}\nRepository: https://github.com/${testClient.org}/${testClient.currentRepo}`);
}