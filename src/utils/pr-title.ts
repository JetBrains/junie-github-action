/**
 * Chooses the title for a pull request the action opens.
 *
 * The title of the issue or pull request that triggered the run is preferred over anything
 * the agent reports. It is written by a person, it always describes the change rather than
 * the work, and it is the same on every run — which the agent's own name is not.
 *
 * The CLI has no field meaning "pull request title". `taskName` is a live session name:
 * `OutputWriter` overwrites it on every `AgentTaskNameUpdatedEvent`, and since the emitter
 * sits in `AbstractAgentWorker`, every orchestrated sub-agent (plan, code, review, git)
 * raises one as it finishes. Whichever ran last wins, so in goal mode `taskName` is that
 * sub-agent's summary of its own step — "Review Step 1 Implementation and Validation
 * Completeness". Wording varies per run, so no filter over it can be relied on; it is used
 * only when there is no issue or pull request to take a title from.
 */

/**
 * Wording that describes the agent's process instead of the code.
 *
 * Single words that also occur in legitimate titles ("Add review widget") are matched only
 * at the start, which is where a step name lands; unambiguous phrases are matched anywhere.
 */
const INTERNAL_WORKFLOW_PATTERNS: RegExp[] = [
    /\bstep\s*\d+/i,
    /\bstage\s*\d+/i,
    /\bdeliverables?\b/i,
    /\bcompleteness\b/i,
    /\btask\s+execution\b/i,
    /\bfinal\s+report\b/i,
    /\borchestrated?\b/i,
    /\bsub-?agent\b/i,

    /^\s*(re)?view(s|ed|ing)?\b/i,
    /^\s*implement(s|ed|ing|ation|ations)?\b/i,
    /^\s*validat(e|es|ed|ing|ion|ions)\b/i,
    /^\s*verif(y|ies|ied|ying|ication)\b/i,
    /^\s*plan(s|ned|ning)?\b/i,
    /^\s*analy[sz](e|es|ed|ing|is)\b/i,
    /^\s*summar(y|ies|ise|ize|ised|ized|ising|izing)\b/i,
    /^\s*finaliz(e|es|ed|ing)\b/i,
    /^\s*complet(e|es|ed|ing|ion)\b/i,
];

/**
 * Whether `title` names the agent's own process rather than the change.
 */
export function isInternalWorkflowTitle(title: string | undefined | null): boolean {
    if (!title || title.trim() === "") {
        return true;
    }

    return INTERNAL_WORKFLOW_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Picks the title to publish, in order of trustworthiness.
 *
 * 1. The triggering issue or pull request title — human-written and stable.
 * 2. `taskName`, only when there is no such entity (for example a `workflow_dispatch` run
 *    driven by a bare prompt) and only if it does not describe the agent's own workflow.
 * 3. The caller's generic fallback.
 *
 * @param taskName - `taskName` from the CLI output
 * @param entityTitle - Title of the issue or pull request that triggered the run
 * @param fallback - Used when neither is usable
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
