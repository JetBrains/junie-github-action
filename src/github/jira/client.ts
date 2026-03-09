#!/usr/bin/env bun

import {Version3Client} from 'jira.js';

/**
 * Jira API client wrapper
 */
class JiraClient {

    private readonly client: Version3Client;
    private readonly email = process.env.JIRA_EMAIL;
    private readonly apiToken = process.env.JIRA_API_TOKEN;

    constructor() {
        this.client = this.createClient();
    }

    private createClient(): Version3Client {
        const jiraBaseUrl = process.env.JIRA_BASE_URL;

        if (!this.email || !this.apiToken || !jiraBaseUrl) {
            throw new Error('⚠️ Jira credentials not found. Set JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL to enable Jira integration.');
        }

        return new Version3Client({
            host: jiraBaseUrl,
            authentication: {
                basic: {
                    email: this.email,
                    apiToken: this.apiToken,
                },
            },
        });
    }

    /**
     * Adds a comment to a Jira issue
     *
     * @param issueKey - Jira issue key (e.g., PROJ-123)
     * @param adfDocument - Comment in Atlassian Document Format (ADF)
     * @returns comment ID if successful, null otherwise
     */
    async addComment(issueKey: string, adfDocument: any): Promise<string | null> {
        try {
            console.log(`Adding comment to Jira issue ${issueKey}`);

            const result = await this.client.issueComments.addComment({
                issueIdOrKey: issueKey,
                comment: adfDocument,
            });

            console.log(`✓ Successfully added comment to Jira issue ${issueKey}, comment ID: ${result.id}`);
            return result.id ?? null;
        } catch (error) {
            console.error(`Error adding comment to Jira issue ${issueKey}:`, error);
            return null;
        }
    }

    /**
     * Updates an existing comment on a Jira issue
     *
     * @param issueKey - Jira issue key (e.g., PROJ-123)
     * @param commentId - ID of the comment to update
     * @param adfDocument - New comment content in Atlassian Document Format (ADF)
     * @returns true if successful, false otherwise
     */
    async updateComment(issueKey: string, commentId: string, adfDocument: any): Promise<boolean> {
        try {
            console.log(`Updating comment ${commentId} on Jira issue ${issueKey}`);

            await this.client.issueComments.updateComment({
                issueIdOrKey: issueKey,
                id: commentId,
                comment: adfDocument,
            });

            console.log(`✓ Successfully updated comment ${commentId} on Jira issue ${issueKey}`);
            return true;
        } catch (error) {
            console.error(`Error updating comment ${commentId} on Jira issue ${issueKey}:`, error);
            return false;
        }
    }

    /**
     * Downloads an attachment from Jira
     *
     * @param url - Full URL to the attachment (e.g., https://domain.atlassian.net/rest/api/2/attachment/content/10000)
     * @returns Buffer containing the file data
     */
    async downloadAttachment(url: string): Promise<Buffer> {
        console.log(`Downloading attachment from ${url}`);

        const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');

        const response = await fetch(url, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download attachment from ${url}: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
}

// Singleton instance
let jiraClientInstance: JiraClient | null = null;

/**
 * Get the singleton instance of JiraClient
 * @returns JiraClient instance
 */
export function getJiraClient(): JiraClient {
    if (!jiraClientInstance) {
        jiraClientInstance = new JiraClient();
    }
    return jiraClientInstance;
}
