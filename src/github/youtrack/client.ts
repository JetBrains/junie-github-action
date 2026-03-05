#!/usr/bin/env bun

/**
 * YouTrack API client wrapper
 */
class YouTrackClient {

    private readonly token: string;
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        const token = process.env.YOUTRACK_TOKEN;
        if (!token) {
            throw new Error('⚠️ YouTrack token not found. Set YOUTRACK_TOKEN to enable YouTrack integration.');
        }
        if (!baseUrl) {
            throw new Error('⚠️ YouTrack base URL not provided.');
        }
        this.token = token;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    private get authHeaders(): HeadersInit {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    }

    /**
     * Adds a plain-text (Markdown) comment to a YouTrack issue
     *
     * @param issueId - YouTrack issue ID (e.g., PROJ-123)
     * @param text - Comment text in Markdown
     * @returns comment ID if successful, null otherwise
     */
    async addComment(issueId: string, text: string): Promise<string | null> {
        try {
            console.log(`Adding comment to YouTrack issue ${issueId}`);

            const url = `${this.baseUrl}/api/issues/${issueId}/comments?fields=id`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.authHeaders,
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            const data = await response.json() as { id: string };
            console.log(`✓ Successfully added comment to YouTrack issue ${issueId}, comment ID: ${data.id}`);
            return data.id;
        } catch (error) {
            console.error(`Error adding comment to YouTrack issue ${issueId}:`, error);
            return null;
        }
    }

    /**
     * Updates an existing comment on a YouTrack issue
     *
     * @param issueId - YouTrack issue ID (e.g., PROJ-123)
     * @param commentId - ID of the comment to update
     * @param text - New comment text in Markdown
     * @returns true if successful, false otherwise
     */
    async updateComment(issueId: string, commentId: string, text: string): Promise<boolean> {
        try {
            console.log(`Updating comment ${commentId} on YouTrack issue ${issueId}`);

            const url = `${this.baseUrl}/api/issues/${issueId}/comments/${commentId}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.authHeaders,
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            console.log(`✓ Successfully updated comment ${commentId} on YouTrack issue ${issueId}`);
            return true;
        } catch (error) {
            console.error(`Error updating comment ${commentId} on YouTrack issue ${issueId}:`, error);
            return false;
        }
    }

    /**
     * Downloads an attachment from YouTrack using Bearer token auth
     *
     * @param url - Full URL to the attachment
     * @returns Buffer containing the file data
     */
    async downloadAttachment(url: string): Promise<Buffer> {
        console.log(`Downloading YouTrack attachment from ${url}`);

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${this.token}` },
        });

        if (!response.ok) {
            throw new Error(`Failed to download attachment from ${url}: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
}

// Singleton instance
let youtrackClientInstance: YouTrackClient | null = null;

/**
 * Get the singleton instance of YouTrackClient.
 * Requires YOUTRACK_TOKEN environment variable to be set.
 * @param baseUrl - YouTrack instance base URL (used only on first call)
 */
export function getYouTrackClient(baseUrl: string): YouTrackClient {
    if (!youtrackClientInstance) {
        youtrackClientInstance = new YouTrackClient(baseUrl);
    }
    return youtrackClientInstance;
}
