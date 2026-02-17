#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import {Octokit} from "@octokit/rest";
import {GITHUB_API_URL} from "../github/api/config";
import {readFile} from "fs/promises";

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
    code_block: string;
    code_suggestion?: string;  // Optional - if not provided, no suggestion block
    // Internal fields (set automatically)
    lineNumber?: number;
    startLineNumber?: number;
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
 * Reads file content from the local filesystem
 * Assumes the server is running in the project directory on the correct branch
 */
async function fetchFileContent(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch (error: any) {
        throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
}

/**
 * Finds line numbers for the given code_block in file content
 */
function findLinesForCode(
    fileContent: string,
    code_block: string
): { startLine: number; endLine: number } | null {
    const fileLines = fileContent.split("\n");
    const searchLines = code_block.split("\n");
    const numLines = searchLines.length;

    // Try to find exact match
    for (let i = 0; i <= fileLines.length - numLines; i++) {
        let match = true;
        for (let j = 0; j < numLines; j++) {
            if (fileLines[i + j] !== searchLines[j]) {
                match = false;
                break;
            }
        }

        if (match) {
            return {
                startLine: i + 1, // 1-based indexing
                endLine: i + numLines,
            };
        }
    }

    // Try normalized match (trimmed lines)
    for (let i = 0; i <= fileLines.length - numLines; i++) {
        let match = true;
        for (let j = 0; j < numLines; j++) {
            if (fileLines[i + j].trim() !== searchLines[j].trim()) {
                match = false;
                break;
            }
        }

        if (match) {
            return {
                startLine: i + 1,
                endLine: i + numLines,
            };
        }
    }

    return null;
}

/**
 * Validates inline comment parameters
 */
function validateCommentParams(params: InlineCommentParams): {
    valid: boolean;
    error?: string;
} {
    if (!params.code_block) {
        return {
            valid: false,
            error: "code_block must be provided",
        };
    }

    if (!params.code_block.trim()) {
        return {
            valid: false,
            error: "code_block cannot be empty",
        };
    }

    // If code_suggestion is provided, validate it
    if (params.code_suggestion && !params.code_suggestion.trim()) {
        return {
            valid: false,
            error: "code_suggestion cannot be empty if provided",
        };
    }

    return {valid: true};
}

/**
 * Creates an inline review comment on a PR
 */
async function createInlineComment(
    octokit: Octokit,
    config: ServerConfig,
    params: InlineCommentParams
): Promise<CommentResult> {
    try {
        // Prepare the comment request
        const requestParams: any = {
            owner: config.owner,
            repo: config.repo,
            pull_number: config.prNumber,
            body: params.commentBody,
            path: params.filePath,
            commit_id: config.commitSha,
            side: "RIGHT",
        };

        if (params.startLineNumber) {
            // Multi-line comment
            requestParams.start_line = params.startLineNumber;
            requestParams.start_side = "RIGHT";
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

    const octokit = new Octokit({
        auth: config.token,
        baseUrl: config.apiUrl,
    });

    const server = new McpServer({
        name: "Junie GitHub Inline Comment Server",
        version: "1.0.0",
    });

    // @ts-expect-error - MCP SDK v1.25+ has deep type instantiation issues
    server.registerTool(
        "post_inline_review_comment",
        {
            description: "Posts an inline code review comment on a pull request. Can optionally include a code suggestion. Automatically finds the code location by searching for code_block.",
            inputSchema: {
                filePath: z
                    .string()
                    .describe("The file path to comment on (e.g., 'src/utils/helper.ts')"),
                code_block: z
                    .string()
                    .describe("The exact code block to comment on (can be multiple lines). Must match existing code in the file exactly. IMPORTANT: Include enough context to make this block unique in the file. If the code appears multiple times (e.g., closing braces, common patterns), the first match will be used. Add surrounding lines to ensure uniqueness."),
                commentBody: z
                    .string()
                    .describe("The comment text. If code_suggestion is provided, this will be displayed after the suggestion block as explanation."),
                code_suggestion: z
                    .string()
                    .optional()
                    .describe("Optional: The suggested replacement code (can be multiple lines). If provided, creates a GitHub suggestion block that will REPLACE the ENTIRE code_block range. IMPORTANT: Ensure the replacement is syntactically complete, properly indented, and includes all necessary code. Partial line replacements will break the code. If omitted, creates a regular comment without suggestion."),
            },
        },
        async ({filePath, code_block, code_suggestion, commentBody}) => {
            try {
                const params: InlineCommentParams = {
                    filePath,
                    code_block,
                    code_suggestion,
                    commentBody,
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

                // Read file content from local filesystem
                const fileContent = await fetchFileContent(filePath);

                // Find line numbers for code_block
                const lines = findLinesForCode(fileContent, code_block);
                if (!lines) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify({
                                    status: "error",
                                    error: "Could not find code_block in the file",
                                    details: "Make sure code_block exactly matches the code in the file. Check for whitespace and line breaks.",
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }

                // Generate comment body
                let fullCommentBody: string;
                if (code_suggestion) {
                    // With suggestion block
                    const suggestionBlock = `\`\`\`suggestion\n${code_suggestion}\n\`\`\``;
                    fullCommentBody = `${suggestionBlock}\n\n${commentBody}`;
                } else {
                    // Without suggestion - just the comment
                    fullCommentBody = commentBody;
                }

                // Set line numbers for GitHub API
                params.startLineNumber = lines.startLine < lines.endLine ? lines.startLine : undefined;
                params.lineNumber = lines.endLine;
                params.commentBody = fullCommentBody;

                // Create the comment
                const result = await createInlineComment(octokit, config, params);

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
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                status: "error",
                                error: error.message || "Unknown error occurred",
                            }, null, 2),
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
