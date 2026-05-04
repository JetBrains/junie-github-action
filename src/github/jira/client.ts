#!/usr/bin/env bun

import {Version3Client} from 'jira.js';

export type JiraCommentBody = {
    text: string;
};

export type JiraAttachmentInfo = {
    filename: string;
    mimeType: string;
    size: number;
    contentUrl: string;
};

function extractTextFromADF(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;

    if (node.type === 'text') {
        let text = node.text || '';
        if (node.marks) {
            for (const mark of node.marks) {
                if (mark.type === 'link' && mark.attrs?.href) {
                    text += ' ' + mark.attrs.href;
                }
            }
        }
        return text;
    }

    if (node.type === 'inlineCard') {
        return node.attrs?.url || '';
    }

    if (node.content && Array.isArray(node.content)) {
        return node.content.map(extractTextFromADF).join('');
    }

    return '';
}

/**
 * Jira API client wrapper
 */
class JiraClient {

    private readonly client: Version3Client;
    private readonly email = process.env.JIRA_EMAIL;
    private readonly apiToken = process.env.JIRA_API_TOKEN;
    private readonly jiraBaseUrl = process.env.JIRA_BASE_URL;

    constructor() {
        this.client = this.createClient();
    }

    private createClient(): Version3Client {
        if (!this.email || !this.apiToken || !this.jiraBaseUrl) {
            throw new Error('⚠️ Jira credentials not found. Set JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL to enable Jira integration.');
        }

        return new Version3Client({
            host: this.jiraBaseUrl,
            authentication: {
                basic: {
                    email: this.email,
                    apiToken: this.apiToken,
                },
            },
        });
    }

    async createIssue(projectKey: string, summary: string, description: string): Promise<string> {
        console.log(`Creating Jira issue in project ${projectKey}: "${summary}"`);

        const result = await this.client.issues.createIssue({
            fields: {
                project: {key: projectKey},
                summary,
                description: {
                    type: "doc",
                    version: 1,
                    content: [{type: "paragraph", content: [{type: "text", text: description}]}]
                },
                issuetype: {name: "Task"}
            }
        });

        const issueKey = result.key!;
        console.log(`Successfully created Jira issue: ${issueKey}`);
        return issueKey;
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

    async addTextComment(issueKey: string, text: string): Promise<void> {
        await this.addComment(issueKey, {
            type: "doc",
            version: 1,
            content: [{type: "paragraph", content: [{type: "text", text}]}]
        });
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
                body: adfDocument,
            });

            console.log(`✓ Successfully updated comment ${commentId} on Jira issue ${issueKey}`);
            return true;
        } catch (error) {
            console.error(`Error updating comment ${commentId} on Jira issue ${issueKey}:`, error);
            return false;
        }
    }

    async addAttachment(issueKey: string, filename: string, content: string): Promise<JiraAttachmentInfo> {
        console.log(`Adding attachment ${filename} to Jira issue ${issueKey}...`);

        const attachments = await this.client.issueAttachments.addAttachment({
            issueIdOrKey: issueKey,
            attachment: {
                filename,
                file: Buffer.from(content),
                mimeType: 'text/plain'
            }
        });

        const attachment = attachments[0];
        console.log(`Successfully added attachment ${filename} to Jira issue: ${issueKey}`);
        return {
            filename: attachment.filename!,
            mimeType: attachment.mimeType!,
            size: attachment.size!,
            contentUrl: attachment.content!
        };
    }

    async waitForComment(issueKey: string, message: string): Promise<JiraCommentBody> {
        console.log(`Waiting for comment containing "${message}" in Jira issue ${issueKey}...`);

        const pollIntervalMs = 30000;
        const timeoutMs = 12 * 60 * 1000;
        const end = Date.now() + timeoutMs;

        while (Date.now() < end) {
            const data = await this.client.issueComments.getComments({issueIdOrKey: issueKey});
            const comments = data.comments || [];
            const comment = comments.find(c => extractTextFromADF(c.body).includes(message));

            if (comment) {
                console.log(`Found comment with message: "${message}"`);
                return {text: extractTextFromADF(comment.body)};
            }

            await new Promise(r => setTimeout(r, pollIntervalMs));
        }

        throw new Error(`Junie didn't post comment containing "${message}" in Jira issue ${issueKey}`);
    }

    async deleteIssue(issueKey: string): Promise<void> {
        console.log(`Deleting Jira issue ${issueKey}...`);
        await this.client.issues.deleteIssue({issueIdOrKey: issueKey});
        console.log(`Successfully deleted Jira issue: ${issueKey}`);
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
