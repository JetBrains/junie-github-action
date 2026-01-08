#!/usr/bin/env bun

import {Version3Client} from 'jira.js';

/**
 * Jira transition IDs (may vary by Jira instance/project)
 * These should be configurable via environment variables
 */
export const JIRA_TRANSITIONS = {
    IN_PROGRESS: process.env.JIRA_TRANSITION_IN_PROGRESS || "21",
    IN_REVIEW: process.env.JIRA_TRANSITION_IN_REVIEW || "31",
} as const;

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
     * Transitions a Jira issue to a new status
     *
     * @param issueKey - Jira issue key (e.g., PROJ-123)
     * @param transitionId - ID of the transition to perform
     * @returns true if successful, false otherwise
     */
    async transitionIssue(issueKey: string, transitionId: string): Promise<boolean> {
        try {
            console.log(`Transitioning Jira issue ${issueKey} with transition ID ${transitionId}`);

            await this.client.issues.doTransition({
                issueIdOrKey: issueKey,
                transition: {
                    id: transitionId,
                },
            });

            console.log(`✓ Successfully transitioned Jira issue ${issueKey}`);
            return true;
        } catch (error) {
            console.error(`Error transitioning Jira issue ${issueKey}:`, error);
            return false;
        }
    }

    /**
     * Adds a comment to a Jira issue
     *
     * @param issueKey - Jira issue key (e.g., PROJ-123)
     * @param comment - Comment text (supports Jira markdown)
     * @returns true if successful, false otherwise
     */
    async addComment(issueKey: string, comment: string): Promise<boolean> {
        try {
            console.log(`Adding comment to Jira issue ${issueKey}`);

            await this.client.issueComments.addComment({
                issueIdOrKey: issueKey,
                comment: comment,
            });

            console.log(`✓ Successfully added comment to Jira issue ${issueKey}`);
            return true;
        } catch (error) {
            console.error(`Error adding comment to Jira issue ${issueKey}:`, error);
            return false;
        }
    }

    /**
     * Starts work on a Jira issue (transitions to "In Progress")
     */
    async startIssue(issueKey: string): Promise<boolean> {
        return await this.transitionIssue(issueKey, JIRA_TRANSITIONS.IN_PROGRESS);
    }

    /**
     * Moves Jira issue to review (transitions to "In Review")
     */
    async moveIssueToReview(issueKey: string): Promise<boolean> {
        return await this.transitionIssue(issueKey, JIRA_TRANSITIONS.IN_REVIEW);
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
