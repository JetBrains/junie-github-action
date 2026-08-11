import {describe, expect, test} from "bun:test";
import {isInternalWorkflowTitle, resolvePrTitle} from "../src/utils/pr-title";
import {PR_TITLE_TEMPLATE} from "../src/constants/github";

describe("isInternalWorkflowTitle", () => {
    test("rejects the title goal mode actually produced", () => {
        expect(isInternalWorkflowTitle("Review Step 1 Implementation and Validation Completeness"))
            .toBe(true);
    });

    test("rejects step and stage names", () => {
        const titles = [
            "Step 2: wire up the parser",
            "Stage 3 cleanup",
            "Reviewing the plan",
            "Review of the code changes",
            "Implementation of the export feature",
            "Validation Completeness",
            "Planning the refactor",
            "Task execution summary",
            "Final report",
            "Orchestrated run results",
            "Sub-agent output",
            "Deliverables",
        ];

        for (const title of titles) {
            expect(isInternalWorkflowTitle(title)).toBe(true);
        }
    });

    test("rejects inflected forms of the process verbs", () => {
        // A step reported as "Reviewed ..." is the same failure as "Review ...".
        const titles = [
            "Reviewed implementation completeness",
            "Reviewed and updated export logic",
            "Implemented export functionality",
            "Validated the payment flow",
            "Verifying the migration",
            "Planned refactor of auth",
            "Summarizing changes",
            "Analysis of the parser",
            "Completed the export work",
        ];

        for (const title of titles) {
            expect(isInternalWorkflowTitle(title)).toBe(true);
        }
    });

    test("accepts imperative present, which is how people write change titles", () => {
        // The sub-agents report steps in past tense, gerunds or nouns; "Implement X" is a
        // normal PR title and must not be thrown away in favour of the generic fallback.
        const titles = [
            "Implement dark mode toggle",
            "Complete migration to Kotlin 2.0",
            "Verify webhook signatures on ingest",
            "Validate user input on the signup form",
            "Plan B routing for the payment gateway",
            "Finalize the export format",
        ];

        for (const title of titles) {
            expect(isInternalWorkflowTitle(title)).toBe(false);
        }
    });

    test("still rejects a bare process verb or one heading a noun phrase", () => {
        const titles = [
            "Implement",
            "Review: the code changes",
            "Verify - migration",
            "Complete of the export work",
        ];

        for (const title of titles) {
            expect(isInternalWorkflowTitle(title)).toBe(true);
        }
    });

    test("accepts process words that appear mid-title", () => {
        // Only a leading process verb signals a step name; these are real titles.
        expect(isInternalWorkflowTitle("Add review widget to the dashboard")).toBe(false);
        expect(isInternalWorkflowTitle("Remove deprecated validation helper")).toBe(false);
        expect(isInternalWorkflowTitle("Plantable seeds parser fix")).toBe(false);
    });

    test("rejects an empty or missing title", () => {
        expect(isInternalWorkflowTitle(undefined)).toBe(true);
        expect(isInternalWorkflowTitle("")).toBe(true);
        expect(isInternalWorkflowTitle("   ")).toBe(true);
    });

    test("accepts titles that describe the change", () => {
        const titles = [
            "Add export functionality to users module",
            "Fix NPE in payment processing",
            "Cache the user lookup to cut p99 latency",
            "Add review widget to the dashboard",
            "Support pagination in the search endpoint",
        ];

        for (const title of titles) {
            expect(isInternalWorkflowTitle(title)).toBe(false);
        }
    });
});

describe("resolvePrTitle", () => {
    const FALLBACK = "Junie finished task successfully";

    test("prefers the triggering entity title over the agent's task name", () => {
        expect(resolvePrTitle(
            "Review Step 1 Implementation and Validation Completeness",
            "Users cannot export their data",
            FALLBACK,
        )).toBe("Users cannot export their data");
    });

    test("prefers the entity title even when the task name looks fine", () => {
        // The entity title is stable across runs; taskName is not. Predictability wins.
        expect(resolvePrTitle("Add export functionality to users module", "Add CSV export", FALLBACK))
            .toBe("Add CSV export");
    });

    test("uses the task name when there is no entity to take a title from", () => {
        // e.g. workflow_dispatch driven by a bare prompt
        expect(resolvePrTitle("Add export functionality to users module", undefined, FALLBACK))
            .toBe("Add export functionality to users module");
    });

    test("falls back when there is no entity and the task name is a step name", () => {
        expect(resolvePrTitle("Review Step 1 Implementation", undefined, FALLBACK)).toBe(FALLBACK);
    });

    test("falls back when the agent reported no title at all", () => {
        expect(resolvePrTitle(undefined, undefined, FALLBACK)).toBe(FALLBACK);
    });

    test("trims both sources", () => {
        expect(resolvePrTitle(undefined, "  Add CSV export  ", FALLBACK)).toBe("Add CSV export");
        expect(resolvePrTitle("  Fix NPE in payment processing  ", "   ", FALLBACK))
            .toBe("Fix NPE in payment processing");
    });

    test("a step name can never reach the PR title when an issue exists", () => {
        const stepNames = [
            "Review Step 1 Implementation and Validation Completeness",
            "Reviewed implementation completeness",
            "Implemented export functionality",
            "Some phrasing nobody predicted",
        ];

        for (const stepName of stepNames) {
            expect(PR_TITLE_TEMPLATE(resolvePrTitle(stepName, "Add CSV export to users module", FALLBACK)))
                .toBe("[Junie]: Add CSV export to users module");
        }
    });

    test("produces a prefixed, workflow-free PR title end to end", () => {
        const resolved = resolvePrTitle(
            "Review Step 1 Implementation and Validation Completeness",
            "Add CSV export to the users module",
            FALLBACK,
        );
        const prTitle = PR_TITLE_TEMPLATE(resolved);

        expect(prTitle).toBe("[Junie]: Add CSV export to the users module");
        expect(prTitle.startsWith("[Junie]: ")).toBe(true);
        expect(isInternalWorkflowTitle(resolved)).toBe(false);
    });
});
