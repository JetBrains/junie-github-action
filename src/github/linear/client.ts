import { LinearClient } from '@linear/sdk';

/**
 * Linear state IDs (UUIDs)
 * These should be configurable via environment variables
 */
export const LINEAR_STATES = {
    IN_PROGRESS: process.env.LINEAR_STATE_IN_PROGRESS,
    IN_REVIEW: process.env.LINEAR_STATE_IN_REVIEW,
} as const;

/**
 * Linear API client wrapper
 */
export class MyLinearClient {
    private client: LinearClient;

    constructor() {
        const apiKey = process.env.LINEAR_API_TOKEN;
        if (!apiKey) {
            throw new Error('⚠️ Linear API token not found. Set LINEAR_API_TOKEN to enable Linear integration.');
        }
        this.client = new LinearClient({ apiKey });
    }

    /**
     * Adds a comment to a Linear issue
     *
     * @param issueId - Linear issue ID (UUID or human-readable key like ABC-123)
     * @param body - Comment body in markdown
     * @returns true if successful, false otherwise
     */
    async addComment(issueId: string, body: string): Promise<boolean> {
        try {
            console.log(`Adding comment to Linear issue ${issueId}`);
            await this.client.createComment({ issueId, body });
            console.log(`✓ Successfully added comment to Linear issue ${issueId}`);
            return true;
        } catch (error) {
            console.error(`Error adding comment to Linear issue ${issueId}:`, error);
            return false;
        }
    }

    /**
     * Updates the status of a Linear issue
     *
     * @param issueId - Linear issue ID
     * @param stateId - ID of the state to transition to
     * @returns true if successful, false otherwise
     */
    async updateStatus(issueId: string, stateId: string): Promise<boolean> {
        try {
            console.log(`Updating status of Linear issue ${issueId} to ${stateId}`);
            await this.client.updateIssue(issueId, { stateId });
            console.log(`✓ Successfully updated status of Linear issue ${issueId}`);
            return true;
        } catch (error) {
            console.error(`Error updating status of Linear issue ${issueId}:`, error);
            return false;
        }
    }

    /**
     * Moves Linear issue to "In Progress"
     */
    async startIssue(issueId: string): Promise<boolean> {
        if (!LINEAR_STATES.IN_PROGRESS) {
            console.warn('LINEAR_STATE_IN_PROGRESS is not set, skipping status update');
            return false;
        }
        return await this.updateStatus(issueId, LINEAR_STATES.IN_PROGRESS);
    }

    /**
     * Moves Linear issue to "In Review"
     */
    async moveIssueToReview(issueId: string): Promise<boolean> {
        if (!LINEAR_STATES.IN_REVIEW) {
            console.warn('LINEAR_STATE_IN_REVIEW is not set, skipping status update');
            return false;
        }
        return await this.updateStatus(issueId, LINEAR_STATES.IN_REVIEW);
    }
}

// Singleton instance
let linearClientInstance: MyLinearClient | null = null;

/**
 * Get the singleton instance of LinearClient
 * @returns LinearClient instance
 */
export function getLinearClient(): MyLinearClient {
    if (!linearClientInstance) {
        linearClientInstance = new MyLinearClient();
    }
    return linearClientInstance;
}
