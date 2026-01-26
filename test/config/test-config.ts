interface E2EConfig {
    githubToken: string;
    org: string;
}

export const e2eConfig: E2EConfig = {
    githubToken: process.env.GITHUB_TOKEN || "",
    org: process.env.TEST_ORG || "melotria",
};