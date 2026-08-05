/**
 * Condenses Junie's final summary for the pull request description and feedback comment.
 *
 * In goal mode the orchestrated flow reports every step it took and happily pastes what the
 * tools printed — compiler help, logs, file contents — straight into the summary, so the
 * description ends up hundreds of lines long. The task itself asks for a short summary; this
 * is the safety net for when it comes back verbose anyway.
 *
 * Pasted output cannot be filtered line by line: a help screen consists of ordinary sentences
 * ("Watch input files.") that look exactly like prose. So instead of cleaning the whole text,
 * only the parts a description actually needs are kept — the opening narrative and the list of
 * changes — and everything from the first line of tool output onwards is dropped.
 */

/** Hard cap for the condensed summary: a few short paragraphs. */
export const MAX_SUMMARY_LENGTH = 1200;

/** How many change bullets are kept; a description does not need more. */
const MAX_CHANGE_BULLETS = 10;

/**
 * Lines that are output of a tool rather than something Junie wrote about its work. They mark
 * where the narrative ends, so only unmistakable shapes are listed here.
 */
const TOOL_OUTPUT_PATTERNS = [
    /^-{1,2}[\w-]+(?:,\s*-{1,2}[\w-]+)*(?:[=\s]|$)/,        // "--noEmit", "--project, -p"
    /^(?:type|default|one of|one or more|usage|synopsis|options|commands?|arguments?)\s*:/i,
    /^[A-Z][A-Z\d]*(?:[\s/-][A-Z\d]+)+$/,                   // "COMMON COMMANDS", "COMMAND LINE FLAGS"
    /^\s*at\s+\S+\s*\(?[^\s)]+:\d+/,                        // stack frames
    /^(?:\[\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T)/,                // log timestamps
    /^(?:\$|>|#{1,6}\s*\$)\s*\S/,                           // shell prompts
    // Bare command invocations ("tsc --noEmit", "bun test") as opposed to prose mentioning them
    /^(?:tsc|npm|npx|bun|bunx|yarn|pnpm|node|deno|python3?|pip3?|go|cargo|gradlew?|\.\/gradlew|mvn|make|docker|git|pytest|jest|eslint|ruff|mypy)\b[^.!?]*$/,
];

/** Version banners ("tsc: The TypeScript Compiler - Version 7.0.2", "Version 7.0.2"). */
const VERSION_BANNER = /\bversion\s+v?\d+\.\d+\S*\s*$/i;

/** Headings Junie puts in front of the list of changes it made. */
const CHANGE_LIST_HEADING =
    /^(?:#{1,6}\s*|\*{1,2})?(?:changes|changes made|what changed|what was done|list of changes)\b:?\**\s*$/i;

const BULLET = /^[-*+]\s+\S/;

function isToolOutputLine(line: string): boolean {
    if (TOOL_OUTPUT_PATTERNS.some(pattern => pattern.test(line))) {
        return true;
    }
    // A version banner is a short standalone line; a sentence that happens to name a version
    // ("Bumped the CLI to version 2548.5.") is prose and must survive.
    return line.length <= 80 && !line.includes(". ") && VERSION_BANNER.test(line);
}

/** Drops fenced code blocks, which never belong in a description. */
function withoutCodeBlocks(result: string): string[] {
    const lines: string[] = [];
    let inCodeFence = false;

    for (const line of result.split("\n")) {
        if (/^\s*(?:```|~~~)/.test(line)) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (!inCodeFence) {
            lines.push(line);
        }
    }

    return lines;
}

/**
 * Removes a trailing sentence that has no end punctuation: when the narrative runs straight
 * into pasted output ("..., the Version 7.0.2"), the fragment left behind is not a sentence.
 */
function dropDanglingSentence(text: string): string {
    // The output can start in the middle of the last narrative line
    // ("..., the Version 7.0.2"), so the glued banner goes first.
    const withoutGluedBanner = text.replace(VERSION_BANNER, "").trimEnd();

    if (/[.!?:)]$/.test(withoutGluedBanner)) {
        return withoutGluedBanner;
    }

    const lastEnd = Math.max(
        withoutGluedBanner.lastIndexOf("."),
        withoutGluedBanner.lastIndexOf("!"),
        withoutGluedBanner.lastIndexOf("?")
    );
    return lastEnd > 0 ? withoutGluedBanner.substring(0, lastEnd + 1) : withoutGluedBanner;
}

/**
 * The narrative Junie opens with: everything up to the first line of tool output, the first
 * change-list heading or the first bullet.
 */
function takeIntro(lines: string[]): {intro: string; end: number} {
    const kept: string[] = [];
    let index = 0;
    let stoppedAtOutput = false;

    for (; index < lines.length; index++) {
        const line = lines[index].trim();

        if (CHANGE_LIST_HEADING.test(line) || BULLET.test(line)) {
            break;
        }
        if (isToolOutputLine(line)) {
            stoppedAtOutput = true;
            break;
        }
        kept.push(lines[index]);
    }

    const intro = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return {intro: stoppedAtOutput ? dropDanglingSentence(intro) : intro, end: index};
}

/**
 * The list of changes, wherever it sits in the summary: the bullets that follow a
 * change-list heading, or the leading bullets when the summary is written as a plain list.
 */
function takeChangeList(lines: string[], from: number): string[] {
    const bullets: string[] = [];

    for (let index = from; index < lines.length && bullets.length < MAX_CHANGE_BULLETS; index++) {
        const line = lines[index].trim();

        if (!line || CHANGE_LIST_HEADING.test(line)) {
            continue;
        }
        if (BULLET.test(line) && !isToolOutputLine(line)) {
            bullets.push(line);
            continue;
        }
        // Any other content means the list is over (or never started).
        if (bullets.length > 0) {
            break;
        }
    }

    return bullets;
}

/**
 * Cuts the text to the length limit, preferring a paragraph, then a sentence, then a word
 * boundary, so the summary never ends mid-word.
 */
function capLength(summary: string): string {
    if (summary.length <= MAX_SUMMARY_LENGTH) {
        return summary;
    }

    const head = summary.substring(0, MAX_SUMMARY_LENGTH);

    const lastParagraph = head.lastIndexOf("\n\n");
    if (lastParagraph > MAX_SUMMARY_LENGTH * 0.5) {
        return head.substring(0, lastParagraph).trimEnd();
    }

    const lastSentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"));
    if (lastSentence > MAX_SUMMARY_LENGTH * 0.5) {
        return head.substring(0, lastSentence + 1).trimEnd();
    }

    const lastSpace = head.lastIndexOf(" ");
    const cut = lastSpace > MAX_SUMMARY_LENGTH * 0.5 ? lastSpace : MAX_SUMMARY_LENGTH - 1;
    return head.substring(0, cut).trimEnd() + "…";
}

/**
 * Reduces the summary to the opening narrative plus the list of changes, capped in length.
 * Returns the original text (capped) when neither can be recognized, so a summary written in
 * an unexpected shape is passed through rather than lost.
 */
export function condenseSummary(result: string): string {
    if (!result) {
        return result;
    }

    const lines = withoutCodeBlocks(result);
    const {intro, end} = takeIntro(lines);
    const bullets = takeChangeList(lines, end);

    const parts = [intro, bullets.join("\n")].filter(part => part.length > 0);
    const condensed = parts.join("\n\n").trim();

    return condensed ? capLength(condensed) : capLength(result.trim());
}
