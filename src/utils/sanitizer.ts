/**
 * Sanitizer for preventing prompt-injection attacks in user-submitted content.
 *
 * Design — two phases (see sanitizeContent):
 *   A) canonicalize(): decode HTML/XML entities and strip invisible characters,
 *      repeatedly, until a plain-text fixed point is reached. This dissolves the
 *      obfuscation an attacker would use to smuggle payloads past the filters.
 *   B) content filters: with the text canonical, strip the now-visible hidden
 *      channels (comments, markdown alt/title, hidden attributes, tokens).
 *
 * Protects against hidden channels:
 * - Hidden HTML comments with malicious instructions
 * - Invisible Unicode characters (zero-width, control, bidi/direction marks)
 * - Hidden attributes (alt, title, aria-label, data-*, placeholder)
 * - HTML entity obfuscation (named + numeric, including double/nested encoding)
 * - GitHub token exposure
 *
 * Non-goal: this does NOT detect *visible* prompt injection written in plain
 * text (e.g. "Ignore all previous instructions"). Such text is preserved on
 * purpose; defending against it belongs to the surrounding system (least-
 * privilege tokens, human approval, isolation), not to a text sanitizer.
 */

import {escapeRegExp} from "../github/validation/trigger";
import {decodeHTMLStrict} from "entities";

// Size limits for outputs to prevent ARG_MAX issues (2MB Linux limit)
export const OUTPUT_SIZE_LIMITS = {
    TITLE: 250,        // Title should be short
    SUMMARY: 15000,    // ~15KB for detailed summary
    PR_BODY: 40000,    // ~40KB for PR description
} as const;

/**
 * Remove HTML comments that could contain hidden instructions
 * Pattern: <!-- anything -->
 */
function stripHtmlComments(content: string): string {
    return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Remove invisible characters that could be used for obfuscation
 * Includes:
 * - Zero-width characters (U+200B, U+200C, U+200D, U+FEFF)
 * - Control characters (U+0000-U+001F, U+007F-U+009F)
 * - Soft hyphens (U+00AD)
 * - Unicode direction marks, incl. LRM/RLM (U+200E, U+200F, U+202A-U+202E, U+2066-U+2069)
 * - Replacement character (U+FFFD) emitted by the entity decoder for invalid refs
 */
function stripInvisibleCharacters(content: string): string {
    // Zero-width characters
    content = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

    // Control characters (excluding tab \u0009, newline \u000A, carriage return \u000D)
    content = content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");

    // Soft hyphens
    content = content.replace(/\u00AD/g, "");

    // Unicode direction marks, including left-to-right / right-to-left marks
    // (can be used to reverse or disguise text visually)
    content = content.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");

    // Replacement character: the entity decoder emits U+FFFD for invalid numeric
    // references (e.g. &#0;); it carries no legitimate content, so drop it.
    content = content.replace(/\uFFFD/g, "");

    return content;
}

/**
 * Remove alt text from markdown images
 * Pattern: ![alt text](url) -> ![](url)
 */
function stripMarkdownImageAltText(content: string): string {
    return content.replace(/!\[[^\]]*\]\(/g, "![](");
}

/**
 * Remove title attributes from markdown links
 * Pattern: [text](url "title") -> [text](url)
 */
function stripMarkdownLinkTitles(content: string): string {
    // Double quotes
    content = content.replace(/(\[[^\]]*\]\([^)]+)\s+"[^"]*"\)/g, "$1)");
    // Single quotes
    content = content.replace(/(\[[^\]]*\]\([^)]+)\s+'[^']*'\)/g, "$1)");
    return content;
}

/**
 * Remove HTML attributes that could contain hidden instructions
 * Strips: alt, title, aria-label, data-*, placeholder
 */
function stripHiddenAttributes(content: string): string {
    // alt attributes
    content = content.replace(/\salt\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\salt\s*=\s*[^\s>]+/gi, "");

    // title attributes
    content = content.replace(/\stitle\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\stitle\s*=\s*[^\s>]+/gi, "");

    // aria-label attributes
    content = content.replace(/\saria-label\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\saria-label\s*=\s*[^\s>]+/gi, "");

    // data-* attributes (custom attributes)
    content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*[^\s>]+/gi, "");

    // placeholder attributes
    content = content.replace(/\splaceholder\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\splaceholder\s*=\s*[^\s>]+/gi, "");

    return content;
}

/**
 * Maximum number of passes for the canonicalization fixed-point loop.
 *
 * Bounds worst-case work on pathological, deeply nested entity payloads (a
 * denial-of-service guard) while still resolving realistic multi-layer
 * encodings such as &amp;lt; -> &lt; -> <.
 */
const MAX_CANONICALIZATION_PASSES = 10;

/**
 * Decode HTML/XML character references using a spec-compliant decoder.
 *
 * Delegates to the `entities` library instead of hand-written regexes: it knows
 * the full HTML5 named entity set (&lt; &excl; &commat; &lpar; ...) plus both
 * numeric forms (decimal &#60; and hex &#x3c; / &#X3C;), so obfuscation via any
 * entity form is canonicalized. Strict mode requires a trailing ';', which
 * avoids mangling legitimate bare ampersands (e.g. "AT&T"). Non-printable or
 * invalid references are handled by stripInvisibleCharacters after decoding, so
 * legitimate non-ASCII text (e.g. "&#233;" -> "é") is preserved.
 */
function decodeHtmlEntities(content: string): string {
    return decodeHTMLStrict(content);
}

/**
 * Phase A — canonicalization.
 *
 * Collapse every layer of obfuscation into a single, plain-text form BEFORE any
 * content-based filter runs. This is the crux of the design: once the text is
 * canonical, the Phase B filters in sanitizeContent have nothing left to slip
 * past, which structurally closes the class of "decode-after-filter" bypasses.
 *
 * Each pass first strips invisible characters (which can break up entities or
 * delimiters, e.g. "&l\u200Bt;" or "<\u200B!--") and then decodes entities
 * (which can themselves hide invisible characters or delimiters, e.g. "&#8203;"
 * or "&#60;!--"). Repeating the pair to a fixed point resolves multi- and
 * double-encoded payloads; a pass cap bounds worst-case work on adversarial
 * deeply nested input.
 */
function canonicalize(content: string): string {
    let previous: string;
    let passes = 0;
    do {
        previous = content;
        content = stripInvisibleCharacters(content);
        content = decodeHtmlEntities(content);
        passes++;
    } while (content !== previous && passes < MAX_CANONICALIZATION_PASSES);

    // Final strip so any invisible characters revealed by the last decode pass
    // (e.g. a decoded zero-width character) are removed before filtering.
    return stripInvisibleCharacters(content);
}

/**
 * Redact GitHub tokens to prevent accidental exposure
 * Detects all GitHub token formats:
 * - ghp_ (Personal Access - Classic)
 * - gho_ (OAuth)
 * - ghs_ (Installation)
 * - ghr_ (Refresh)
 * - github_pat_ (Fine-grained)
 */
function redactGitHubTokens(content: string): string {
    // Classic tokens (4 char prefix + 36 char token = 40 total)
    content = content.replace(/\bghp_[A-Za-z0-9]{36,}\b/g, "[REDACTED_TOKEN]");
    content = content.replace(/\bgho_[A-Za-z0-9]{36,}\b/g, "[REDACTED_TOKEN]");
    content = content.replace(/\bghs_[A-Za-z0-9]{36,}\b/g, "[REDACTED_TOKEN]");
    content = content.replace(/\bghr_[A-Za-z0-9]{36,}\b/g, "[REDACTED_TOKEN]");

    // Fine-grained tokens (11+ chars after prefix)
    content = content.replace(/\bgithub_pat_[A-Za-z0-9_]{11,}\b/g, "[REDACTED_TOKEN]");

    return content;
}

/**
 * Master sanitization function that applies all security measures.
 * Use this to sanitize any user-submitted content before including it in prompts.
 *
 * Two phases:
 *   A) canonicalize() — decode entities and strip invisible characters to a
 *      plain-text fixed point, dissolving obfuscation;
 *   B) content filters — strip the now-visible hidden channels (comments,
 *      markdown alt/title, hidden attributes, GitHub tokens).
 *
 * Non-goal: visible, plain-text prompt injection is intentionally preserved
 * (see the file header). This function removes hidden channels, not intent.
 */
export function sanitizeContent(content: string | null | undefined): string {
    if (!content) {
        return "";
    }

    // Phase A: canonicalize away obfuscation (entities + invisible characters)
    // so the Phase B filters cannot be bypassed by encoding or hidden characters.
    let sanitized = canonicalize(content);

    // Phase B: strip hidden channels from the now-canonical text.
    sanitized = stripHtmlComments(sanitized);
    sanitized = stripMarkdownImageAltText(sanitized);
    sanitized = stripMarkdownLinkTitles(sanitized);
    sanitized = stripHiddenAttributes(sanitized);
    sanitized = redactGitHubTokens(sanitized);

    return sanitized;
}

/**
 * Truncates content to specified max length to prevent exceeding ARG_MAX limits
 * Tries to cut at word boundary for better readability
 *
 * @param content - Content to truncate
 * @param maxLength - Maximum allowed length in characters
 * @returns Truncated content with indicator if truncated
 */
export function truncateOutput(content: string | undefined, maxLength: number): string {
    if (!content) {
        return "";
    }

    if (content.length <= maxLength) {
        return content;
    }

    const truncationMarker = "\n\n... (output truncated due to size limits)";
    const targetLength = maxLength - truncationMarker.length;

    // Try to cut at last word boundary (space, newline, punctuation)
    const cutPoint = content.lastIndexOf(" ", targetLength);
    const actualCutPoint = cutPoint > targetLength * 0.9 ? cutPoint : targetLength;

    return content.substring(0, actualCutPoint).trimEnd() + truncationMarker;
}

/**
 * Strips XML tags from Junie's output
 * Removes tags like <review>, <summary>, </review>, etc.
 * while preserving the text content inside them
 */
function stripXmlTags(content: string): string {
    return content.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>\n?/g, "");
}

/**
 * Lightweight sanitization for Junie's output before posting to GitHub
 * Prevents:
 * - Token leakage (Junie accidentally exposing GitHub tokens)
 * - Self-triggering (Junie mentioning trigger phrase in output)
 * Also strips XML tags from the output
 */
export function sanitizeJunieOutput(
    content: string | undefined,
    triggerPhrase: string
): string {
    if (!content) {
        return "";
    }

    let sanitized = stripXmlTags(content);
    sanitized = redactGitHubTokens(sanitized);

    // Replace trigger phrase with neutral term to prevent self-triggering
    // Uses the same word-boundary pattern as trigger detection to avoid replacing inside words
    if (triggerPhrase) {
        const regex = new RegExp(`(^|\\s)${escapeRegExp(triggerPhrase)}([\\s.,!?;:]|$)`, 'gi');
        sanitized = sanitized.replace(regex, '$1the assistant$2');
    }

    return sanitized;
}
