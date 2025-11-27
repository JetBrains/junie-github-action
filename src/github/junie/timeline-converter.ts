// Utility to convert GraphQL timeline items to our internal format
// This removes code duplication between PR and Issue data fetching

import {
    GraphQLTimelineItemNode,
    isCrossReferencedEventNode,
    isIssueCommentNode,
    isReferencedEventNode
} from "../api/queries";
import {GitHubTimelineData, GitHubTimelineEventData} from "../api/github-data";

/**
 * Convert GraphQL timeline items to internal format
 * Uses type guards instead of direct __typename checks for type safety
 */
export function convertTimelineItems(nodes: GraphQLTimelineItemNode[]): GitHubTimelineData {
    const events: GitHubTimelineEventData[] = [];

    for (const item of nodes) {
        if (isIssueCommentNode(item)) {
            events.push({
                event: "commented",
                body: item.body,
                user: {login: item.author?.login || "ghost"},
                created_at: item.createdAt,
                html_url: item.url
            });
        } else if (isReferencedEventNode(item)) {
            events.push({
                event: "referenced",
                commit_id: item.commit?.oid || null,
                created_at: item.createdAt
            });
        } else if (isCrossReferencedEventNode(item)) {
            const source = item.source;
            events.push({
                event: "cross-referenced",
                created_at: item.createdAt,
                source: {
                    type: source?.__typename === "PullRequest" ? "pull_request" : "issue",
                    issue: source ? {
                        number: source.number,
                        title: source.title,
                        html_url: source.url,
                        pull_request: source.__typename === "PullRequest" ? {
                            url: source.url,
                            html_url: source.url
                        } : undefined
                    } : undefined
                }
            });
        }
    }

    return {events};
}
