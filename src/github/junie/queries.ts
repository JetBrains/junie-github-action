// GraphQL queries for GitHub data

export const PULL_REQUEST_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        title
        body
        bodyHTML
        state
        url
        author {
          login
        }
        baseRefName
        headRefName
        headRefOid
        baseRefOid
        additions
        deletions
        changedFiles
        createdAt
        updatedAt

        # Commits
        commits(first: 100) {
          totalCount
          nodes {
            commit {
              oid
              messageHeadline
              message
              committedDate
            }
          }
        }

        # Changed files
        files(first: 100) {
          nodes {
            path
            additions
            deletions
            changeType
          }
        }

        # Timeline events (comments, cross-references, etc)
        timelineItems(first: 100, itemTypes: [ISSUE_COMMENT, CROSS_REFERENCED_EVENT, REFERENCED_EVENT]) {
          nodes {
            __typename
            ... on IssueComment {
              id
              databaseId
              body
              author {
                login
              }
              createdAt
              url
            }
            ... on CrossReferencedEvent {
              source {
                ... on Issue {
                  number
                  title
                  url
                }
                ... on PullRequest {
                  number
                  title
                  url
                }
              }
              createdAt
            }
            ... on ReferencedEvent {
              commit {
                oid
                message
              }
              createdAt
            }
          }
        }

        # Reviews with their comments
        reviews(first: 100) {
          nodes {
            id
            databaseId
            author {
              login
            }
            body
            state
            submittedAt
            url

            # Review comments (threads)
            comments(first: 100) {
              nodes {
                id
                databaseId
                body
                path
                position
                diffHunk
                author {
                  login
                }
                createdAt
                url
                replyTo {
                  id
                }
                # GitHub doesn't have a direct "resolved" field in GraphQL
                # We'll need to infer it from the thread structure
              }
            }
          }
        }
      }
    }
  }
`;

export const ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        number
        title
        body
        bodyHTML
        state
        url
        author {
          login
        }
        createdAt
        updatedAt

        # Timeline events
        timelineItems(first: 100, itemTypes: [ISSUE_COMMENT, CROSS_REFERENCED_EVENT, REFERENCED_EVENT]) {
          nodes {
            __typename
            ... on IssueComment {
              id
              databaseId
              body
              author {
                login
              }
              createdAt
              url
            }
            ... on CrossReferencedEvent {
              source {
                ... on Issue {
                  number
                  title
                  url
                }
                ... on PullRequest {
                  number
                  title
                  url
                }
              }
              createdAt
            }
            ... on ReferencedEvent {
              commit {
                oid
                message
              }
              createdAt
            }
          }
        }
      }
    }
  }
`;
