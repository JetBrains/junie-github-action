// ============================================================================
// GitHub Workflow Environment Variables
// ============================================================================

export const ENV_VARS = {
    // GitHub standard environment variables
    GITHUB_TOKEN: "GITHUB_TOKEN",
    GITHUB_API_URL: "GITHUB_API_URL",
    GITHUB_SERVER_URL: "GITHUB_SERVER_URL",
    GITHUB_RUN_ID: "GITHUB_RUN_ID",
    GITHUB_HEAD_REF: "GITHUB_HEAD_REF",
    GITHUB_WORKFLOW_REF: "GITHUB_WORKFLOW_REF",
    GITHUB_ACTION_PATH: "GITHUB_ACTION_PATH",

    // Junie-specific environment variables
    OVERRIDE_GITHUB_TOKEN: "OVERRIDE_GITHUB_TOKEN",
    DEFAULT_WORKFLOW_TOKEN: "DEFAULT_WORKFLOW_TOKEN",
    JSON_JUNIE_OUTPUT: "JSON_JUNIE_OUTPUT",
    JUNIE_WORKING_DIR: "JUNIE_WORKING_DIR",
    APP_TOKEN: "APP_TOKEN",
    TRIGGER_PHRASE: "TRIGGER_PHRASE",
    ASSIGNEE_TRIGGER: "ASSIGNEE_TRIGGER",
    LABEL_TRIGGER: "LABEL_TRIGGER",
    TARGET_BRANCH: "TARGET_BRANCH",
    ALLOWED_MCP_SERVERS: "ALLOWED_MCP_SERVERS",
    RESOLVE_CONFLICTS: "RESOLVE_CONFLICTS",
    CREATE_NEW_BRANCH_FOR_PR: "CREATE_NEW_BRANCH_FOR_PR",
    SILENT_MODE: "SILENT_MODE",

    // Job status and results
    IS_JOB_FAILED: "IS_JOB_FAILED",
    ERROR: "ERROR",
    COMMIT_SHA: "COMMIT_SHA",
    PR_LINK: "PR_LINK",
    WORKING_DIR: "WORKING_DIR",
} as const;

// ============================================================================
// GitHub Actions Output Variables
// ============================================================================

export const OUTPUT_VARS = {
    // Authentication and tokens
    EJ_AUTH_GITHUB_TOKEN: "EJ_AUTH_GITHUB_TOKEN",
    EJ_CLI_TOKEN: "EJ_CLI_TOKEN",

    // Task and MCP configuration
    JUNIE_JSON_TASK: "JUNIE_JSON_TASK",
    EJ_MCP_CONFIG: "EJ_MCP_CONFIG",

    // Exception handling
    EXCEPTION: "EXCEPTION",

    // Actor information
    ACTOR_NAME: "ACTOR_NAME",
    ACTOR_EMAIL: "ACTOR_EMAIL",

    // Context and branches
    PARSED_CONTEXT: "PARSED_CONTEXT",
    BASE_BRANCH: "BASE_BRANCH",
    WORKING_BRANCH: "WORKING_BRANCH",
    IS_NEW_BRANCH: "IS_NEW_BRANCH",

    // Comments and feedback
    INIT_COMMENT_ID: "INIT_COMMENT_ID",

    // Action metadata
    ACTION_TO_DO: "ACTION_TO_DO",

    // Junie results
    JUNIE_TITLE: "JUNIE_TITLE",
    JUNIE_SUMMARY: "JUNIE_SUMMARY",

    // Commit and PR information
    COMMIT_MESSAGE: "COMMIT_MESSAGE",
    PR_TITLE: "PR_TITLE",
    PR_BODY: "PR_BODY",

    // Skip flag
    SHOULD_SKIP: "SHOULD_SKIP",
} as const;
