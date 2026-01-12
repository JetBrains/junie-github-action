#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import {Octokit} from "@octokit/rest";
import {GITHUB_API_URL} from "../github/api/config";

/**
 * GitHub Comment MCP Server
 *
 * Provides MCP tools for updating GitHub issue/PR comments during Junie execution.
 * This allows Junie to provide real-time progress updates by modifying the initial
 * feedback comment as it works.
 */

interface ServerConfig {
    token: string;
    owner: string;
    repo: string;
    commentId: number;
    apiUrl: string;
}

/**
 * Validates and retrieves required environment variables
 */
function loadServerConfiguration(): ServerConfig {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.REPO_OWNER;
    const repo = process.env.REPO_NAME;
    const commentId = process.env.JUNIE_COMMENT_ID;
    const apiUrl = process.env.GITHUB_API_URL || GITHUB_API_URL;

    if (!token || !owner || !repo || !commentId) {
        const missing = [];
        if (!token) missing.push("GITHUB_TOKEN");
        if (!owner) missing.push("REPO_OWNER");
        if (!repo) missing.push("REPO_NAME");
        if (!commentId) missing.push("JUNIE_COMMENT_ID");

        process.exit(1);
    }

    const parsedCommentId = parseInt(commentId, 10);
    if (isNaN(parsedCommentId) || parsedCommentId <= 0) {
        process.exit(1);
    }

    return {
        token,
        owner,
        repo,
        commentId: parsedCommentId,
        apiUrl,
    };
}

/**
 * Updates a GitHub comment with new content
 */
async function updateComment(
    config: ServerConfig,
    newBody: string
): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
        const octokit = new Octokit({
            auth: config.token,
            baseUrl: config.apiUrl,
        });

        const response = await octokit.rest.issues.updateComment({
            owner: config.owner,
            repo: config.repo,
            comment_id: config.commentId,
            body: newBody,
        });

        return {
            success: true,
            url: response.data.html_url,
        };
    } catch (error) {
        let errorMsg = "Unknown error occurred";

        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === "string") {
            errorMsg = error;
        }

        return {
            success: false,
            error: errorMsg,
        };
    }
}

/**
 * Initializes and runs the MCP server
 */
async function startServer() {
    const config = loadServerConfiguration();

    const server = new McpServer({
        name: "Junie GitHub Comment Server",
        version: "1.0.0",
    });

    // @ts-expect-error - MCP SDK v1.25+ has deep type instantiation issues
    server.registerTool(
        "update_progress_comment",
        {
            description: "Updates the Junie progress comment with new content. Use this to keep users informed about ongoing work.",
            inputSchema: {
                content: z
                    .string()
                    .describe("The updated comment content in GitHub Flavored Markdown format"),
            },
        },
        async ({content}) => {
            const result = await updateComment(config, content);

            if (result.success) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                status: "updated",
                                comment_id: config.commentId,
                                html_url: result.url,
                                message: "Comment successfully updated",
                            }, null, 2),
                        },
                    ],
                };
            } else {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify({
                                status: "failed",
                                comment_id: config.commentId,
                                error: result.error,
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

    process.on("SIGINT", () => {
        server.close();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        server.close();
        process.exit(0);
    });
}

startServer().catch(() => {
    process.exit(1);
});
