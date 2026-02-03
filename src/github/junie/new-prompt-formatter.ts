import {
    FetchedData,
    GraphQLCommitNode,
    GraphQLFileNode,
    GraphQLReviewCommentNode,
    GraphQLReviewNode,
    GraphQLTimelineItemNode,
    isCrossReferencedEventNode,
    isIssueCommentNode,
    isReferencedEventNode
} from "../api/queries";
import {
    isIssueCommentEvent,
    isIssuesEvent,
    isJiraWorkflowDispatchEvent,
    isPullRequestEvent,
    isPullRequestReviewCommentEvent,
    isPullRequestReviewEvent,
    isPushEvent,
    isTriggeredByUserInteraction,
    JiraIssuePayload,
    JunieExecutionContext
} from "../context";
import {downloadJiraAttachmentsAndRewriteText} from "./attachment-downloader";
import {sanitizeContent} from "../../utils/sanitizer";
import {GIT_OPERATIONS_NOTE} from "../../constants/github";
import {extractJunieArgs} from "../../utils/junie-args-parser";

export interface GeneratePromptResult {
    prompt: string;
    customJunieArgs: string[];
}

export class NewGitHubPromptFormatter {

    async generatePrompt(context: JunieExecutionContext, fetchedData: FetchedData, userPrompt?: string, attachGithubContextToCustomPrompt: boolean = true): Promise<GeneratePromptResult> {
        let customJunieArgs: string[] = [];

        // 1. Extract junie-args from user prompt if provided
        let cleanedUserPrompt = userPrompt;
        if (userPrompt) {
            const parsed = extractJunieArgs(userPrompt);
            cleanedUserPrompt = parsed.cleanedText;
            customJunieArgs.push(...parsed.args);
        }

        // If user provided custom prompt and doesn't want GitHub context, sanitize and return it
        if (cleanedUserPrompt && !attachGithubContextToCustomPrompt) {
            const finalPrompt = sanitizeContent(cleanedUserPrompt + GIT_OPERATIONS_NOTE);
            return {
                prompt: finalPrompt,
                customJunieArgs
            };
        }

        // 2. Handle Jira issue integration
        if (isJiraWorkflowDispatchEvent(context)) {
            const jiraPrompt = await this.generateJiraPrompt(context);
            const parsed = extractJunieArgs(jiraPrompt);
            return {
                prompt: sanitizeContent(parsed.cleanedText),
                customJunieArgs: parsed.args
            };
        }

        const repositoryInfo = this.getRepositoryInfo(context);
        const actorInfo = this.getActorInfo(context);
        const userInstruction = this.getUserInstruction(context, fetchedData, cleanedUserPrompt);
        const prOrIssueInfo = this.getPrOrIssueInfo(context, fetchedData);
        const commitsInfo = this.getCommitsInfo(fetchedData);
        const timelineInfo = this.getTimelineInfo(fetchedData);
        const reviewsInfo = this.getReviewsInfo(fetchedData);
        const changedFilesInfo = this.getChangedFilesInfo(fetchedData);

        // Build the final prompt
        let prompt = `You were triggered as a GitHub AI Assistant by ${context.eventName} action. Your task is to:

${userInstruction ? userInstruction : ""}
${repositoryInfo ? repositoryInfo : ""}
${prOrIssueInfo ? prOrIssueInfo : ""}
${commitsInfo ? commitsInfo : ""}
${timelineInfo ? timelineInfo : ""}
${reviewsInfo ? reviewsInfo : ""}
${changedFilesInfo ? changedFilesInfo : ""}
${actorInfo ? actorInfo : ""}
${GIT_OPERATIONS_NOTE}
`;

        // 3. Extract junie-args from final prompt
        const finalParsed = extractJunieArgs(prompt);
        customJunieArgs.push(...finalParsed.args);
        prompt = finalParsed.cleanedText;

        // Sanitize the entire prompt once to prevent prompt injection attacks
        // This removes HTML comments, invisible characters, obfuscated entities, etc.
        return {
            prompt: sanitizeContent(prompt),
            customJunieArgs
        };
    }

    private async generateJiraPrompt(context: JunieExecutionContext): Promise<string> {
        const jira = context.payload as JiraIssuePayload;

        // Format comments
        const commentsInfo = jira.comments.length > 0
            ? '\n\nComments:\n' + jira.comments.map(comment => {
                const date = new Date(comment.created).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return `[${date}] ${comment.author}:\n${comment.body}`;
            }).join('\n\n')
            : '';

        // Form the complete prompt text
        const promptText = `You were triggered as a GitHub AI Assistant by a Jira issue. Your task is to implement the requested feature or fix based on the Jira issue details below.

<jira_issue>
Issue Key: ${jira.issueKey}
Summary: ${jira.issueSummary}

Description: ${jira.issueDescription}${commentsInfo}
</jira_issue>
${GIT_OPERATIONS_NOTE}
`;

        // Download all attachments referenced in text (single pass), then return
        return await downloadJiraAttachmentsAndRewriteText(promptText, jira.attachments);
    }

    private getUserInstruction(context: JunieExecutionContext, fetchedData: FetchedData, customPrompt?: string): string | undefined {
        let githubUserInstruction
        if (isPullRequestEvent(context)) {
            githubUserInstruction = context.payload.pull_request.body
        } else if (isPullRequestReviewEvent(context)) {
            githubUserInstruction = context.payload.review.body
        } else if (isPullRequestReviewCommentEvent(context)) {
            // For review comments, include thread context
            const commentBody = context.payload.comment.body;
            const threadId = this.findThreadId(context, fetchedData);

            if (threadId) {
                githubUserInstruction = `Review thread #${threadId}:\n${commentBody}`;
            } else {
                githubUserInstruction = commentBody;
            }
        } else if (isIssuesEvent(context)) {
            githubUserInstruction = context.payload.issue.body
        } else if (isIssueCommentEvent(context)) {
            githubUserInstruction = context.payload.comment.body
        }

        const instruction = customPrompt || githubUserInstruction;
        return instruction ? `
        <user_instruction>
        ${instruction}
</user_instruction>` : undefined
    }

    /**
     * Finds the thread ID (root comment ID) for a review comment
     */
    private findThreadId(context: JunieExecutionContext, fetchedData: FetchedData): string | undefined {
        if (!isPullRequestReviewCommentEvent(context)) {
            return undefined;
        }

        const currentCommentId = context.payload.comment.id; // REST API ID (number)

        // Get all comments from all reviews
        const allComments = fetchedData.pullRequest?.reviews?.nodes
            ?.flatMap(r => r.comments.nodes) || [];

        // Find the current comment by databaseId (REST API ID)
        const currentComment = allComments.find(c => c.databaseId === currentCommentId);
        if (!currentComment) return undefined;

        // If it has a replyTo, find the root comment by following the chain
        if (currentComment.replyTo) {
            let root = currentComment;
            while (root.replyTo) {
                const parent = allComments.find(c => c.id === root.replyTo!.id);
                if (parent) {
                    root = parent;
                } else {
                    break;
                }
            }
            return root.databaseId.toString();
        }

        // This is already the root comment
        return currentComment.databaseId.toString();
    }

    private getPrOrIssueInfo(context: JunieExecutionContext, fetchedData: FetchedData): string | undefined {
        if (context.isPR) {
            const prInfo = this.getPrInfo(fetchedData);
            return prInfo ? `<pull_request_info>\n${prInfo}\n</pull_request_info>` : undefined;
        } else if (isTriggeredByUserInteraction(context) && !isPushEvent(context)) {
            const issueInfo = this.getIssueInfo(fetchedData);
            return issueInfo ? `<issue_info>\n${issueInfo}\n</issue_info>` : undefined;
        }
        return undefined
    }

    private getPrInfo(fetchedData: FetchedData): string {
        const pr = fetchedData.pullRequest;
        if (!pr) return "";

        return `PR Number: #${pr.number}
Title: ${pr.title}
Author: @${pr.author?.login}
State: ${pr.state}
Branch: ${pr.headRefName} -> ${pr.baseRefName}
Base Commit: ${pr.baseRefOid}
Head Commit: ${pr.headRefOid}
Stats: +${pr.additions}/-${pr.deletions} (${pr.changedFiles} files, ${pr.commits.totalCount} commits)`
    }

    private getIssueInfo(fetchedData: FetchedData): string {
        const issue = fetchedData.issue;
        if (!issue) return "";

        return `Issue Number: #${issue.number}
Title: ${issue.title}
Author: @${issue.author?.login}
State: ${issue.state}`
    }

    private getCommitsInfo(fetchedData: FetchedData): string | undefined {
        const commits = fetchedData.pullRequest?.commits?.nodes;

        if (!commits || commits.length === 0) {
            return undefined;
        }

        const commitsInfo = this.formatCommits(commits);
        return commitsInfo ? `<commits>\n${commitsInfo}\n</commits>` : undefined;
    }

    private formatCommits(commits: GraphQLCommitNode[]): string {
        return commits.map(({commit}) => {
            const shortHash = commit.oid.substring(0, 7);
            const message = commit.messageHeadline || commit.message || 'No message';
            const date = commit.committedDate || '';
            return `[${date}] ${shortHash} - ${message}`;
        }).join('\n');
    }

    private getTimelineInfo(fetchedData: FetchedData): string | undefined {
        const timelineItems = fetchedData.issue?.timelineItems?.nodes || fetchedData.pullRequest?.timelineItems?.nodes;

        if (!timelineItems || timelineItems.length === 0) {
            return undefined;
        }

        const timelineInfo = this.formatTimelineItems(timelineItems);
        return timelineInfo ? `<timeline>${timelineInfo}</timeline>` : undefined
    }

    private formatTimelineItems(timelineNodes: GraphQLTimelineItemNode[]): string {
        const eventTexts: string[] = [];

        for (const node of timelineNodes) {
            let eventText: string | null = null;

            if (isIssueCommentNode(node)) {
                const author = node.author?.login;
                const body = node.body;
                const createdAt = node.createdAt;
                eventText = `[${createdAt}] Comment by @${author}:
${body}`;
            } else if (isReferencedEventNode(node)) {
                const commitId = node.commit?.oid;
                if (commitId) {
                    const hash = commitId.substring(0, 7);
                    const message = node.commit?.message;
                    const createdAt = node.createdAt;
                    eventText = `[${createdAt}] Referenced commit ${hash}${message ? `: ${message}` : ''}`;
                }
            } else if (isCrossReferencedEventNode(node)) {
                const source = node.source;
                if (source) {
                    const createdAt = node.createdAt;
                    const isPullRequest = source.__typename === 'PullRequest';
                    const type = isPullRequest ? 'PR' : 'Issue';
                    eventText = `[${createdAt}] Cross-referenced from ${type} #${source.number}: ${source.title}`;
                }
            }

            if (eventText) {
                eventTexts.push(eventText);
            }
        }

        return eventTexts.join('\n\n');
    }

    private getReviewsInfo(fetchedData: FetchedData): string | undefined {
        const reviews = fetchedData.pullRequest?.reviews?.nodes;

        if (!reviews || reviews.length === 0) {
            return undefined;
        }

        const reviewsInfo = this.formatReviews(reviews);
        return reviewsInfo ? `<reviews>${reviewsInfo}</reviews>` : undefined
    }

    private formatReviews(reviews: GraphQLReviewNode[]): string {
        const reviewTexts: string[] = [];

        for (const review of reviews) {
            const reviewText = this.formatReview(review);
            if (reviewText.trim()) {
                reviewTexts.push(reviewText);
            }
        }

        if (reviewTexts.length === 0) {
            return '';
        }

        return reviewTexts.join('\n\n---\n\n');
    }

    private formatReview(review: GraphQLReviewNode): string {
        const author = review.author?.login;
        const state = review.state;
        const submittedAt = review.submittedAt;
        const body = review.body;

        let reviewText = `[${submittedAt}] Review by @${author} (${state})`;

        if (body) {
            reviewText += `\n${body}`;
        }

        if (review.comments.nodes.length > 0) {
            reviewText += '\n\nReview Comments:';
            reviewText += this.formatReviewCommentsWithThreads(review.comments.nodes);
        }

        return reviewText;
    }

    /**
     * Formats review comments as a tree structure, showing reply threads
     */
    private formatReviewCommentsWithThreads(comments: GraphQLReviewCommentNode[]): string {
        // Find root comments (those that are not replies)
        const rootComments = comments.filter(c => !c.replyTo);

        // Sort root comments by creation time
        const sortedRoots = [...rootComments].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        let result = '';
        for (const rootComment of sortedRoots) {
            result += this.formatCommentThread(rootComment, comments, 0);
        }

        return result;
    }

    /**
     * Recursively formats a comment and its replies with proper indentation
     */
    private formatCommentThread(
        comment: GraphQLReviewCommentNode,
        allComments: GraphQLReviewCommentNode[],
        depth: number
    ): string {
        const indent = '  '.repeat(depth);
        const commentAuthor = comment.author?.login;
        const commentBody = comment.body;
        const path = comment.path;
        const position = comment.position;

        let result = '';

        // Show file path, position, and thread ID only for root comments
        if (depth === 0) {
            result += `\n\n  Thread #${comment.databaseId} - ${path}`;
            if (position !== null) {
                result += ` (position: ${position})`;
            }
            result += ':';
        }

        result += `\n  ${indent}@${commentAuthor}: ${commentBody}`;

        // Find and format replies to this comment
        const replies = allComments.filter(c => c.replyTo?.id === comment.id);

        // Sort replies by creation time
        const sortedReplies = [...replies].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        for (const reply of sortedReplies) {
            result += this.formatCommentThread(reply, allComments, depth + 1);
        }

        return result;
    }

    private getChangedFilesInfo(fetchedData: FetchedData): string | undefined {
        const files = fetchedData.pullRequest?.files?.nodes;

        if (!files || files.length === 0) {
            return undefined;
        }

        const changedFilesInfo = this.formatChangedFiles(files);
        return changedFilesInfo ? `<changed_files>${changedFilesInfo}</changed_files>` : undefined
    }

    private formatChangedFiles(files: GraphQLFileNode[]): string {
        return files.map(file => {
            const changeType = file.changeType.toLowerCase();
            return `${file.path} (${changeType}) +${file.additions}/-${file.deletions}`;
        }).join('\n');
    }

    private getRepositoryInfo(context: JunieExecutionContext) {
        const repo = context.payload.repository;
        return `<repository>
Repository: ${repo.full_name}
Owner: ${repo.owner.login}
</repository>`
    }

    private getActorInfo(context: JunieExecutionContext) {
        return `<actor>
Triggered by: @${context.actor}
Event: ${context.eventName}${context.eventAction ? ` (${context.eventAction})` : ""}
</actor>`
    }
}
