import {startPoll} from "../utils/test-utils";

export type YouTrackComment = {
    text: string;
    id?: string;
    created?: number;
    updated?: number;
    author?: {
        login?: string;
        name?: string;
    };
};

export class YouTrackClient {
    async createYouTrackIssue(
        projectId: string,
        summary: string,
        description: string,
        youtrackBaseUrl: string,
        youtrackToken: string
    ): Promise<string> {
        console.log(`Creating YouTrack issue in project ${projectId}: "${summary}"`);

        const response = await fetch(`${youtrackBaseUrl}/api/issues?fields=idReadable`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${youtrackToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                project: { shortName: projectId },
                summary: summary,
                description: description
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create YouTrack issue: ${response.status} ${errorText}`);
        }

        const issue: any = await response.json();
        const issueId = issue.idReadable;

        console.log(`Successfully created YouTrack issue: ${issueId}`);
        return issueId;
    }

    async addYouTrackComment(
        issueId: string,
        text: string,
        youtrackBaseUrl: string,
        youtrackToken: string
    ): Promise<void> {
        console.log(`Adding comment to YouTrack issue ${issueId}: "${text}"`);

        const response = await fetch(`${youtrackBaseUrl}/api/issues/${issueId}/comments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${youtrackToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                text: text
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add comment to YouTrack issue ${issueId}: ${response.status} ${errorText}`);
        }

        console.log(`Successfully added comment to YouTrack issue: ${issueId}`);
    }

    async addYouTrackAttachment(
        issueId: string,
        filename: string,
        content: string,
        youtrackBaseUrl: string,
        youtrackToken: string
    ): Promise<void> {
        console.log(`Adding attachment ${filename} to YouTrack issue ${issueId}...`);

        const formData = new FormData();
        const blob = new Blob([content], { type: 'text/plain' });
        formData.append('files', blob, filename);

        const response = await fetch(`${youtrackBaseUrl}/api/issues/${issueId}/attachments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${youtrackToken}`,
                'Accept': 'application/json'
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add attachment ${filename} to YouTrack issue ${issueId}: ${response.status} ${errorText}`);
        }

        console.log(`Successfully added attachment ${filename} to YouTrack issue: ${issueId}`);
    }

    async waitForYouTrackComment(
        issueId: string,
        message: string,
        youtrackBaseUrl: string,
        youtrackToken: string
    ) {
        console.log(`Waiting for Junie to post comment containing "${message}" in YouTrack issue ${issueId}...`);
        let foundComment: YouTrackComment | undefined;
        await startPoll(
            `Junie didn't post comment containing "${message}" in YouTrack issue ${issueId}`,
            {},
            async () => {
                const response = await fetch(`${youtrackBaseUrl}/api/issues/${issueId}/comments?fields=text`, {
                    headers: {
                        'Authorization': `Bearer ${youtrackToken}`,
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    console.log(`Failed to fetch YouTrack comments: ${response.status}`);
                    return false;
                }

                const comments: any[] = await response.json();
                const comment = comments.find(c => c.text && c.text.includes(message));

                if (comment) {
                    console.log(`Found YouTrack comment with message: "${message}"`);
                    foundComment = { text: comment.text };
                    return true;
                }
                return false;
            }
        );
        return foundComment!;
    }

    async deleteYouTrackIssue(
        issueId: string,
        youtrackBaseUrl: string,
        youtrackToken: string
    ): Promise<void> {
        console.log(`Deleting YouTrack issue ${issueId}...`);

        const response = await fetch(`${youtrackBaseUrl}/api/issues/${issueId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${youtrackToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete YouTrack issue ${issueId}: ${response.status} ${errorText}`);
        }

        console.log(`Successfully deleted YouTrack issue: ${issueId}`);
    }
}

export const youTrackClient = new YouTrackClient();
