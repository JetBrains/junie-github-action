#!/usr/bin/env bun

/**
 * Linear API client wrapper (GraphQL)
 */
class LinearClient {
    private readonly token: string;
    private readonly endpoint = 'https://api.linear.app/graphql';

    constructor() {
        this.token = process.env.LINEAR_API_KEY || '';
        console.log(`Debug: LINEAR_API_KEY from env is ${this.token ? 'present' : 'EMPTY'}`);
        if (this.token) {
            const masked = this.token.length > 8 
                ? `${this.token.substring(0, 4)}...${this.token.substring(this.token.length - 4)}` 
                : '****';
            console.log(`LinearClient initialized with token: ${masked}`);
        } else {
            console.warn('LinearClient initialized without token (LINEAR_API_KEY is empty)');
        }
    }

    private hasToken(): boolean {
        if (!this.token) {
            console.error('⚠️ Linear API key not found. Set LINEAR_API_KEY to enable Linear integration.');
            return false;
        }
        return true;
    }

    private get authHeaders(): HeadersInit {
        return {
            'Authorization': this.token,
            'Content-Type': 'application/json',
        };
    }

    /**
     * Executes a GraphQL query/mutation
     */
    private async graphql<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
        if (!this.hasToken()) {
            return null;
        }
        try {
            console.log(`Executing Linear GraphQL: ${query.split('\n')[1].trim().split('(')[0]}`);
            if (variables) {
                console.log('Variables:', JSON.stringify(variables));
            }

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: this.authHeaders,
                body: JSON.stringify({ query, variables }),
            });

            const text = await response.text();
            let json: { data?: T; errors?: any[] };
            
            console.log(`Linear API response status: ${response.status}`);
            
            try {
                json = JSON.parse(text);
            } catch (e) {
                console.error(`Failed to parse Linear API response as JSON. Status: ${response.status} ${response.statusText}`);
                console.error('Raw response:', text);
                return null;
            }

            if (!response.ok || json.errors) {
                console.error(`Linear API error (Status: ${response.status}):`, JSON.stringify(json.errors || `${response.status} ${response.statusText}`, null, 2));
                if (text.includes("Issue not found") || text.includes("issueId")) {
                    console.error("The issueId provided might be invalid or not a UUID. Linear GraphQL requires UUID for issueId.");
                }
                return null;
            }

            return json.data || null;
        } catch (error) {
            console.error('Error calling Linear API:', error);
            return null;
        }
    }

    /**
     * Adds a comment to a Linear issue
     *
     * @param issueId - Linear issue UUID
     * @param body - Comment text in Markdown
     * @returns comment ID if successful, null otherwise
     */
    async addComment(issueId: string, body: string): Promise<string | null> {
        console.log(`Adding comment to Linear issue ${issueId}`);
        
        // Linear requires UUID for issueId. Check if it looks like a UUID.
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(issueId)) {
            console.warn(`⚠️ Warning: issueId "${issueId}" does not look like a UUID. Linear GraphQL API requires a UUID for issueId. Human-readable identifiers like "JUN-11" will not work.`);
        }

        if (body.length > 100) {
            console.log(`Comment body preview: ${body.substring(0, 100)}...`);
        } else {
            console.log(`Comment body: ${body}`);
        }
        
        const query = `
            mutation CommentCreate($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                    success
                    comment {
                        id
                    }
                }
            }
        `;

        const data = await this.graphql<{ commentCreate: { success: boolean; comment: { id: string } } }>(query, { issueId, body });
        
        if (data?.commentCreate?.success) {
            const commentId = data.commentCreate.comment.id;
            console.log(`✓ Successfully added comment to Linear issue ${issueId}, comment ID: ${commentId}`);
            return commentId;
        }

        console.error(`Failed to add comment to Linear issue ${issueId}. Success flag was false or data missing.`);
        return null;
    }

    /**
     * Updates an existing comment in Linear
     *
     * @param commentId - Linear comment UUID
     * @param body - New comment text in Markdown
     * @returns true if successful, false otherwise
     */
    async updateComment(commentId: string, body: string): Promise<boolean> {
        console.log(`Updating Linear comment ${commentId}`);

        const query = `
            mutation CommentUpdate($id: String!, $body: String!) {
                commentUpdate(id: $id, input: { body: $body }) {
                    success
                }
            }
        `;

        const data = await this.graphql<{ commentUpdate: { success: boolean } }>(query, { id: commentId, body });
        
        if (data?.commentUpdate?.success) {
            console.log(`✓ Successfully updated Linear comment ${commentId}`);
            return true;
        }

        return false;
    }
}

// Singleton instance
let linearClientInstance: LinearClient | null = null;

/**
 * Get the singleton instance of LinearClient.
 * Requires LINEAR_API_KEY environment variable to be set.
 */
export function getLinearClient(): LinearClient {
    if (!linearClientInstance) {
        linearClientInstance = new LinearClient();
    }
    return linearClientInstance;
}
