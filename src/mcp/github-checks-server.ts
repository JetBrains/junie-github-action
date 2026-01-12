#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {Octokit} from "@octokit/rest";

const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const HEAD_SHA = process.env.HEAD_SHA;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_URL = process.env.GITHUB_API_URL;

if (!REPO_OWNER || !REPO_NAME || !HEAD_SHA || !GITHUB_TOKEN || !GITHUB_API_URL) {
    process.exit(1);
}

const server = new McpServer({
    name: "GitHub Checks Server",
    version: "1.0.0",
});

server.registerTool(
    "get_pr_failed_checks_info",
    {
        description: "Get detailed information about failed checks for a Pull Request, including extracted error logs",
    },
    async () => {
        try {
            const client = new Octokit({
                auth: GITHUB_TOKEN,
                baseUrl: GITHUB_API_URL,
            });

            const failedChecksResult = await extractFailedChecksInfo(
                client,
                REPO_OWNER!,
                REPO_NAME!,
                HEAD_SHA,
                19000
            );

            if (!failedChecksResult || failedChecksResult.failedChecks.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No failed checks found"
                        }
                    ],
                };
            }

            return {
                content: [
                    {
                        type: "text",
                        text: failedChecksResult.combinedOutput,
                    },
                ],
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${errorMessage}`,
                    },
                ],
                error: errorMessage,
                isError: true,
            };
        }
    }
);

async function runServer() {
    try {
        const transport = new StdioServerTransport();

        await server.connect(transport);

        process.on("exit", () => {
            server.close();
        });
    } catch (error) {
        throw error;
    }
}

interface FailedCheckInfo {
    checkName: string;
    output: string;
}

interface ExtractFailedChecksResult {
    failedChecks: FailedCheckInfo[];
    combinedOutput: string;
}

async function extractFailedChecksInfo(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref: string,
    maxLength: number = 19000
): Promise<ExtractFailedChecksResult> {

    try {
        // Get check runs for the ref
        const {data: checkRuns} = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref,
        });

        // Filter only failed check runs
        const failedCheckRuns = checkRuns.check_runs.filter(
            (check) => check.conclusion === 'failure'
        );

        const failedChecksInfo: FailedCheckInfo[] = [];

        // Extract information from each failed check
        for (const checkRun of failedCheckRuns) {
            const checkInfo = await extractCheckRunLog(
                octokit,
                owner,
                repo,
                checkRun
            );

            if (checkInfo) {
                failedChecksInfo.push({
                    checkName: checkRun.name,
                    output: checkInfo,
                });
            }
        }

        // Combine all failed checks info
        let combinedOutput = failedChecksInfo
            .map((check) => `[Check name] ${check.checkName}\n[Check output]\n${check.output}`)
            .join('\n\n');

        if (combinedOutput.length > maxLength) {
            combinedOutput = combinedOutput.substring(0, maxLength);
        }

        return {
            failedChecks: failedChecksInfo,
            combinedOutput,
        };
    } catch (error) {
        throw error;
    }
}

async function extractCheckRunLog(
    octokit: Octokit,
    owner: string,
    repo: string,
    checkRun: any
): Promise<string | null> {
    try {
        // Extract job ID from details URL
        const jobId = extractJobIdFromUrl(checkRun.html_url, `${owner}/${repo}`);

        if (!jobId) {
            // Fallback to check run output text
            return checkRun.output?.text || null;
        }

        // Try to download workflow job logs
        try {
            const logsResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({owner, repo, job_id: jobId});
            let logText: string;
            const data: unknown = (logsResponse as any).data;
            if (typeof data === 'string') {
                logText = data;
            } else {
                logText = String(data);
            }

            const logLines = logText.split('\n');
            const cleanedLogs = clearTimestampFromGhLogs(logLines);
            const relevantInfo = extractRelevantInfo(cleanedLogs);

            return relevantInfo || null;
        } catch (logError) {
            // Fallback to check run output text
            const outputText = checkRun.output?.text;
            if (outputText) {
                const logLines = outputText.split('\n');
                const relevantInfo = extractRelevantInfo(logLines);
                return relevantInfo || null;
            }
            return null;
        }
    } catch (error) {
        return null;
    }
}

function extractJobIdFromUrl(detailsUrl: string, repoFullName: string): number | null {
    // Check if URL is related to the correct repository
    if (!detailsUrl.includes(repoFullName)) {
        return null;
    }

    // Extract job ID from URL pattern /job/{jobId}
    const match = detailsUrl.match(/\/job\/(\d+)/);
    if (!match || !match[1]) {
        return null;
    }

    const jobId = parseInt(match[1], 10);
    return isNaN(jobId) ? null : jobId;
}

function clearTimestampFromGhLogs(logLines: string[]): string[] {
    return logLines.map((line) => {
        // Remove timestamp prefix (ISO 8601 format at the start of line)
        return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '');
    });
}

/**
 * Extracts relevant error information from test logs.
 *
 * Simple approach: find lines with error keywords and extract context around them.
 * Works universally across all test frameworks and languages.
 */
function extractRelevantInfo(logLines: string[]): string {
    // Universal error keywords (case-insensitive)
    const ERROR_KEYWORDS = [
        'error', 'fail', 'failed', 'failure', 'exception',
        'assert', 'expected', 'actual', 'received',
        'panic', 'fatal', 'critical', 'traceback'
    ];

    const CONTEXT_BEFORE = 10; // Lines to capture before error
    const CONTEXT_AFTER = 50;  // Lines to capture after error

    // Find all lines with error keywords
    const errorRanges = logLines
        .map((line, i) => {
            const lowerLine = line.toLowerCase();
            const hasErrorKeyword = ERROR_KEYWORDS.some(keyword => lowerLine.includes(keyword));

            if (hasErrorKeyword) {
                return {
                    start: Math.max(0, i - CONTEXT_BEFORE),
                    end: Math.min(logLines.length, i + CONTEXT_AFTER + 1)
                };
            }
            return null;
        })
        .filter((range): range is {start: number, end: number} => range !== null);

    // No errors found
    if (errorRanges.length === 0) {
        return '';
    }

    // Merge overlapping ranges
    const mergedRanges: Array<{start: number, end: number}> = [];
    errorRanges.forEach(range => {
        if (mergedRanges.length === 0) {
            mergedRanges.push(range);
        } else {
            const last = mergedRanges[mergedRanges.length - 1];
            // Merge if ranges overlap or are adjacent
            if (range.start <= last.end) {
                last.end = Math.max(last.end, range.end);
            } else {
                mergedRanges.push(range);
            }
        }
    });

    // Extract lines from merged ranges
    const relevantLines: string[] = [];
    for (const range of mergedRanges) {
        if (relevantLines.length > 0) {
            relevantLines.push('');
            relevantLines.push('--- (continuing in different section) ---');
            relevantLines.push('');
        }
        relevantLines.push(...logLines.slice(range.start, range.end));
    }

    return relevantLines.join("\n").trim();
}

runServer().catch(() => {
    process.exit(1);
});
