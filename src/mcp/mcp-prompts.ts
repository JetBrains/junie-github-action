/**
 * MCP Tool Prompts
 *
 * This file contains descriptions of available MCP tools that are automatically
 * added to Junie's prompt when the corresponding MCP server is enabled.
 *
 * These prompts inform Junie about available capabilities without forcing their use.
 */

export const MCP_TOOL_PROMPTS = {
    mcp_github_checks_server: 'Use get_pr_failed_checks_info to retrieve detailed information about failed CI/CD checks if needed.',
    mcp_github_inline_comment_server: 'Use post_inline_review_comment to provide inline code review comments where applicable.',
};

/**
 * Generates a combined prompt section describing all enabled MCP tools
 */
export function generateMcpToolsPrompt(enabledServers: string[]): string {
    const prompts = enabledServers
        .map(server => MCP_TOOL_PROMPTS[server as keyof typeof MCP_TOOL_PROMPTS])
        .filter(Boolean);

    if (prompts.length === 0) {
        return '';
    }

    return `\n\n${prompts.join('\n')}`;
}
