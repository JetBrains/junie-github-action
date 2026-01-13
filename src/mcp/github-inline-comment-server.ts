#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import {Octokit} from "@octokit/rest";
import {GITHUB_API_URL} from "../github/api/config";

/**
 * GitHub Inline Comment MCP Server
 *
 * Provides MCP tools for creating inline code review comments on pull requests.
 * Supports GitHub's suggestion feature for proposing code changes directly in PR comments.
 */

interface ServerConfig {
    token: string;
    owner: string;
    repo: string;
    prNumber: number;
    apiUrl: string;
    commitSha: string;
}

interface InlineCommentParams {
    filePath: string;
    commentBody: string;
    lineNumber?: number;
    startLineNumber?: number;
    diffSide?: "LEFT" | "RIGHT";
}

interface CommentResult {
    success: boolean;
    commentId?: number;
    url?: string;
    error?: string;
    details?: string;
}

/**
 * Loads and validates server configuration from environment variables
 */
function loadConfiguration(): ServerConfig {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.REPO_OWNER;
    const repo = process.env.REPO_NAME;
    const prNumber = process.env.PR_NUMBER;
    const commitSha = process.env.COMMIT_SHA;
    const apiUrl = process.env.GITHUB_API_URL || GITHUB_API_URL;

    if (!token || !owner || !repo || !prNumber || !commitSha) {
        process.exit(1);
    }

    const parsedPrNumber = parseInt(prNumber, 10);
    if (isNaN(parsedPrNumber) || parsedPrNumber <= 0) {
        process.exit(1);
    }

    return {
        token,
        owner,
        repo,
        prNumber: parsedPrNumber,
        apiUrl,
        commitSha,
    };
}

/**
 * Validates inline comment parameters
 */
function validateCommentParams(params: InlineCommentParams): {
    valid: boolean;
    error?: string;
} {
    // Check that either lineNumber or both startLineNumber and lineNumber are provided
    if (!params.lineNumber && !params.startLineNumber) {
        return {
            valid: false,
            error: "Must provide either lineNumber (for single-line) or both startLineNumber and lineNumber (for multi-line)",
        };
    }

    // If startLineNumber is provided, lineNumber must also be provided and greater
    if (params.startLineNumber) {

        if (!params.lineNumber) {
            return {
                valid: false,
                error: "lineNumber is required when startLineNumber is specified",
            };
        }

        if (params.startLineNumber > params.lineNumber) {
            return {
                valid: false,
                error: `startLineNumber (${params.startLineNumber}) must be less than or equal to lineNumber (${params.lineNumber})`,
            };
        }
    }

    return {valid: true};
}

/**
 * Creates an inline review comment on a PR
 */
async function createInlineComment(
    config: ServerConfig,
    params: InlineCommentParams
): Promise<CommentResult> {
    try {
        const octokit = new Octokit({
            auth: config.token,
            baseUrl: config.apiUrl,
        });

        // Prepare the comment request
        const requestParams: any = {
            owner: config.owner,
            repo: config.repo,
            pull_number: config.prNumber,
            body: params.commentBody,
            path: params.filePath,
            commit_id: config.commitSha,
            side: params.diffSide || "RIGHT",
        };

        // Determine if this is a single-line or multi-line comment
        const isMultiLine = params.startLineNumber !== undefined;

        if (isMultiLine) {
            // Multi-line comment
            requestParams.start_line = params.startLineNumber;
            requestParams.start_side = params.diffSide || "RIGHT";
            requestParams.line = params.lineNumber;
        } else {
            // Single-line comment
            requestParams.line = params.lineNumber;
        }

        const response = await octokit.rest.pulls.createReviewComment(requestParams);

        return {
            success: true,
            commentId: response.data.id,
            url: response.data.html_url,
        };
    } catch (error: any) {
        let errorMsg = "Failed to create inline comment";
        let details = "";

        if (error.message) {
            errorMsg = error.message;
        }

        // Provide helpful context for common errors
        if (errorMsg.includes("Validation Failed")) {
            details = "The specified line may not exist in the diff, or the file path may be incorrect. Ensure you're commenting on lines that are part of the PR changes.";
        } else if (errorMsg.includes("Not Found")) {
            details = "Could not find the specified PR, repository, or file. Verify that the PR number and file path are correct.";
        } else if (error.status === 403) {
            details = "Permission denied. The GitHub token may lack required permissions for creating PR comments.";
        }

        return {
            success: false,
            error: errorMsg,
            details,
        };
    }
}

/**
 * Starts the MCP server
 */
async function initializeServer() {
    const config = loadConfiguration();

    const server = new McpServer({
        name: "Junie GitHub Inline Comment Server",
        version: "1.0.0",
    });

    // @ts-expect-error - MCP SDK v1.25+ has deep type instantiation issues
    server.registerTool(
        "post_inline_review_comment",
        {
            description: "Posts an inline code review comment on a specific file and line in the pull request. Supports GitHub's suggestion syntax for proposing code changes.",
            inputSchema: {
                filePath: z
                    .string()
                    .describe("The file path to comment on (e.g., 'src/utils/helper.ts')"),
                commentBody: z
                    .string()
                    .describe("The comment text (supports markdown and GitHub code suggestion blocks). For code suggestions, use: ```suggestion\\nreplacement code\\n```. IMPORTANT: The suggestion block will REPLACE the ENTIRE line range (single line or startLineNumber to lineNumber). Ensure the replacement is syntactically complete and valid."),
                lineNumber: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("Line number for single-line comments, or end line for multi-line comments (required if startLineNumber is not provided)"),
                startLineNumber: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe("Start line for multi-line comments (use with lineNumber parameter for the end line)"),
                diffSide: z
                    .enum(["LEFT", "RIGHT"])
                    .optional()
                    .describe("Side of the diff to comment on: LEFT (old code) or RIGHT (new code). Defaults to RIGHT."),
            },
        },
        async ({filePath, commentBody, lineNumber, startLineNumber, diffSide}) => {
            const params: InlineCommentParams = {
                filePath,
                commentBody,
                lineNumber,
                startLineNumber,
                diffSide,
            };

            // Validate parameters
            const validation = validateCommentParams(params);
            if (!validation.valid) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                status: "error",
                                error: validation.error,
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }

            // Create the comment
            const result = await createInlineComment(config, params);

            if (result.success) {
                const responseData = {
                    status: "success",
                    comment_id: result.commentId,
                    html_url: result.url,
                    file: params.filePath,
                    line_range: params.startLineNumber
                        ? `${params.startLineNumber}-${params.lineNumber}`
                        : `${params.lineNumber}`,
                };

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(responseData, null, 2),
                        },
                    ],
                };
            } else {
                const errorData = {
                    status: "error",
                    error: result.error,
                    details: result.details,
                };

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(errorData, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Graceful shutdown handlers
    const shutdown = () => {
        server.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

initializeServer().catch(() => {
    process.exit(1);
});
