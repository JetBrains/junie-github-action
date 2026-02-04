import { describe, test } from "bun:test";
import { testClient } from "../client/client";

describe("Cleanup Test Repositories", () => {
    test("cleanup old test repositories", async () => {
        const org = testClient.org;

        console.log(`Fetching repositories from organization: ${org}`);

        const { data: repos } = await testClient.getAllReposForOrg()

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const oldTestRepos = repos.filter((repo) => {
            if (!repo.updated_at) return false;

            const updatedAt = new Date(repo.updated_at);
            const isOld = updatedAt < oneWeekAgo;
            const isTestRepo = /junie-test-/.test(repo.name);

            return isOld && isTestRepo;
        });

        console.log(`Found ${oldTestRepos.length} old test repositories to delete`);

        for (const repo of oldTestRepos) {
            try {
                console.log(`Deleting repository: ${repo.name} (updated: ${repo.updated_at})`);
                testClient.deleteRepository(repo.name);
                console.log(`Deleted: ${repo.name}`);
            } catch (error) {
                console.error(`Failed to delete ${repo.name}:`, error);
            }
        }

        console.log(`Cleanup completed. Deleted ${oldTestRepos.length} repositories.`);
    }, 300000);
});
