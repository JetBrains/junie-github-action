interface E2EConfig {
    githubToken: string;
    org: string;
    youtrackToken: string;
    youtrackBaseUrl: string;
    youtrackProjectId: string;
}

export const e2eConfig: E2EConfig = {
    githubToken: process.env.GITHUB_TOKEN || "",
    org: process.env.TEST_ORG || "melotria",
    youtrackToken: process.env.YOUTRACK_TOKEN || "perm-TWFyaWlhLkZhZGVldmE=.NDItNA==.iabFGqqwIwtTldJUi2dvFm3fkxWEGW",
    youtrackBaseUrl: process.env.YOUTRACK_BASE_URL || "https://nikitajunietest.youtrack.cloud",
    youtrackProjectId: process.env.YOUTRACK_PROJECT_ID || "TP",
};