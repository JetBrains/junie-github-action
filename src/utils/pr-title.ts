// Wording that describes the agent's own process instead of the change.
const PROCESS_VERB_STEMS = "(re)?view|implement|validate|verify|plan|analy[sz]e|finalize|complete";

const INTERNAL_WORKFLOW_PATTERNS: RegExp[] = [
    /\bstep\s*\d+/i,
    /\bstage\s*\d+/i,
    /\bdeliverables?\b/i,
    /\bcompleteness\b/i,
    /\btask\s+execution\b/i,
    /\bfinal\s+report\b/i,
    /\borchestrated?\b/i,
    /\bsub-?agent\b/i,

    // Inflected and nominal forms: never how a change is described.
    /^\s*(re)?view(s|ed|ing)\b/i,
    /^\s*implement(s|ed|ing|ation|ations)\b/i,
    /^\s*validat(es|ed|ing|ion|ions)\b/i,
    /^\s*verif(ies|ied|ying|ication)\b/i,
    /^\s*plan(s|ned|ning)\b/i,
    /^\s*analy[sz](es|ed|ing|is)\b/i,
    /^\s*summar(y|ies|ise|ize|ised|ized|ising|izing)\b/i,
    /^\s*finaliz(es|ed|ing)\b/i,
    /^\s*complet(es|ed|ing|ion)\b/i,

    // Bare stem standing alone or heading a noun phrase: "Verify", "Review: ...", "Review of ...".
    new RegExp(`^\\s*(${PROCESS_VERB_STEMS})\\s*([:\\-–—]|$)`, "i"),
    new RegExp(`^\\s*(${PROCESS_VERB_STEMS})\\s+of\\b`, "i"),
];

export function isInternalWorkflowTitle(title: string | undefined | null): boolean {
    if (!title || title.trim() === "") {
        return true;
    }

    return INTERNAL_WORKFLOW_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Picks the title to publish: the triggering issue/pull request title first, then
 * `taskName` (unless it names the agent's workflow), then the generic fallback.
 */
export function resolvePrTitle(
    taskName: string | undefined,
    entityTitle: string | undefined,
    fallback: string,
): string {
    const entity = entityTitle?.trim();

    if (entity) {
        if (taskName && taskName.trim() !== entity) {
            console.log(
                `Titling from the triggering issue or pull request ("${entity}") ` +
                `instead of Junie's task name ("${taskName}").`
            );
        }
        return entity;
    }

    if (!isInternalWorkflowTitle(taskName)) {
        return taskName!.trim();
    }

    console.warn(
        `No issue or pull request title is available, and Junie reported ` +
        `"${taskName}" as the task name, which describes its own workflow rather than ` +
        `the change. Using the generic fallback title.`
    );

    return fallback;
}
