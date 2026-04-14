import {startPoll} from "../utils/test-utils";

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

export class JiraTestClient {
    private getAuthHeader(email: string, apiToken: string): string {
        return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
    }

    async createJiraIssue(
        projectKey: string,
        summary: string,
        description: string,
        jiraBaseUrl: string,
        jiraEmail: string,
        jiraApiToken: string
    ): Promise<string> {
        console.log(`Creating Jira issue in project ${projectKey}: "${summary}"`);

        const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue`, {
            method: 'POST',
            headers: {
                'Authorization': this.getAuthHeader(jiraEmail, jiraApiToken),
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    project: {key: projectKey},
                    summary: summary,
                    description: {
                        type: "doc",
                        version: 1,
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: description
                                    }
                                ]
                            }
                        ]
                    },
                    issuetype: {name: "Task"}
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create Jira issue: ${response.status} ${errorText}`);
        }

        const issue: any = await response.json();
        const issueKey = issue.key;
        console.log(`Successfully created Jira issue: ${issueKey}`);
        return issueKey;
    }

    async addJiraComment(
        issueKey: string,
        text: string,
        jiraBaseUrl: string,
        jiraEmail: string,
        jiraApiToken: string
    ): Promise<void> {
        console.log(`Adding comment to Jira issue ${issueKey}: "${text}"`);

        const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issueKey}/comment`, {
            method: 'POST',
            headers: {
                'Authorization': this.getAuthHeader(jiraEmail, jiraApiToken),
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                body: {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [
                                {
                                    type: "text",
                                    text: text
                                }
                            ]
                        }
                    ]
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add comment to Jira issue ${issueKey}: ${response.status} ${errorText}`);
        }

        console.log(`Successfully added comment to Jira issue: ${issueKey}`);
    }

    async addJiraAttachment(
        issueKey: string,
        filename: string,
        content: string,
        jiraBaseUrl: string,
        jiraEmail: string,
        jiraApiToken: string
    ): Promise<JiraAttachmentInfo> {
        console.log(`Adding attachment ${filename} to Jira issue ${issueKey}...`);

        const formData = new FormData();
        const blob = new Blob([content], {type: 'text/plain'});
        formData.append('file', blob, filename);

        const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
            method: 'POST',
            headers: {
                'Authorization': this.getAuthHeader(jiraEmail, jiraApiToken),
                'Accept': 'application/json',
                'X-Atlassian-Token': 'no-check'
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add attachment ${filename} to Jira issue ${issueKey}: ${response.status} ${errorText}`);
        }

        const attachments: any[] = await response.json();
        const attachment = attachments[0];

        console.log(`Successfully added attachment ${filename} to Jira issue: ${issueKey}`);
        return {
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            contentUrl: attachment.content
        };
    }

    async waitForJiraComment(
        issueKey: string,
        message: string,
        jiraBaseUrl: string,
        jiraEmail: string,
        jiraApiToken: string
    ): Promise<JiraCommentBody> {
        console.log(`Waiting for Junie to post comment containing "${message}" in Jira issue ${issueKey}...`);
        let foundComment: JiraCommentBody | undefined;

        await startPoll(
            `Junie didn't post comment containing "${message}" in Jira issue ${issueKey}`,
            {},
            async () => {
                const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issueKey}/comment`, {
                    headers: {
                        'Authorization': this.getAuthHeader(jiraEmail, jiraApiToken),
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    console.log(`Failed to fetch Jira comments: ${response.status}`);
                    return false;
                }

                const data: any = await response.json();
                const comments: any[] = data.comments || [];
                const comment = comments.find(c => {
                    const text = extractTextFromADF(c.body);
                    return text.includes(message);
                });

                if (comment) {
                    console.log(`Found Jira comment with message: "${message}"`);
                    foundComment = {text: extractTextFromADF(comment.body)};
                    return true;
                }
                return false;
            }
        );

        return foundComment!;
    }

    async deleteJiraIssue(
        issueKey: string,
        jiraBaseUrl: string,
        jiraEmail: string,
        jiraApiToken: string
    ): Promise<void> {
        console.log(`Deleting Jira issue ${issueKey}...`);

        const response = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issueKey}`, {
            method: 'DELETE',
            headers: {
                'Authorization': this.getAuthHeader(jiraEmail, jiraApiToken),
                'Accept': 'application/json'
            }
        });

        console.log(`Successfully deleted Jira issue: ${issueKey}`);
    }
}

export const jiraTestClient = new JiraTestClient();
