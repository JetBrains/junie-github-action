/**
 * Sanitizer for preventing prompt injection attacks in user-submitted content.
 *
 * Protects against:
 * - Hidden HTML comments with malicious instructions
 * - Invisible Unicode characters (zero-width, control chars)
 * - Text direction manipulation (right-to-left override)
 * - Hidden attributes (alt, title, aria-label, data-*)
 * - HTML entity obfuscation
 * - GitHub token exposure
 */

import {escapeRegExp} from "../github/validation/trigger";

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
 * - Unicode direction marks (U+202A-U+202E, U+2066-U+2069)
 */
function stripInvisibleCharacters(content: string): string {
    // Zero-width characters
    content = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

    // Control characters (excluding tab \u0009, newline \u000A, carriage return \u000D)
    content = content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");

    // Soft hyphens
    content = content.replace(/\u00AD/g, "");

    // Unicode direction marks (can be used to reverse text visually)
    content = content.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");

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
 * Normalize HTML entities to prevent obfuscation
 * Decodes &#72; (decimal) and &#x48; (hex) to actual characters
 * Only keeps printable ASCII characters (32-126)
 */
function normalizeHtmlEntities(content: string): string {
    // Decode numeric decimal entities (&#72; = 'H')
    content = content.replace(/&#(\d+);/g, (_, dec) => {
        const num = parseInt(dec, 10);
        // Only decode printable ASCII range
        if (num >= 32 && num <= 126) {
            return String.fromCharCode(num);
        }
        // Remove non-printable entities
        return "";
    });

    // Decode hex entities (&#x48; = 'H')
    content = content.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const num = parseInt(hex, 16);
        // Only decode printable ASCII range
        if (num >= 32 && num <= 126) {
            return String.fromCharCode(num);
        }
        // Remove non-printable entities
        return "";
    });

    return content;
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
 * Master sanitization function that applies all security measures
 * Use this function to sanitize any user-submitted content before including in prompts
 */
export function sanitizeContent(content: string | null | undefined): string {
    if (!content) {
        return "";
    }

    let sanitized = content;

    // Apply all sanitization steps in sequence
    sanitized = stripHtmlComments(sanitized);
    sanitized = stripInvisibleCharacters(sanitized);
    sanitized = stripMarkdownImageAltText(sanitized);
    sanitized = stripMarkdownLinkTitles(sanitized);
    sanitized = stripHiddenAttributes(sanitized);
    sanitized = normalizeHtmlEntities(sanitized);
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
 * Lightweight sanitization for Junie's output before posting to GitHub
 * Prevents:
 * - Token leakage (Junie accidentally exposing GitHub tokens)
 * - Self-triggering (Junie mentioning trigger phrase in output)
 */
export function sanitizeJunieOutput(
    content: string | undefined,
    triggerPhrase: string
): string {
    if (!content) {
        return "";
    }

    let sanitized =  redactGitHubTokens(content);

    // Replace trigger phrase with neutral term to prevent self-triggering
    // Uses the same word-boundary pattern as trigger detection to avoid replacing inside words
    if (triggerPhrase) {
        const regex = new RegExp(`(^|\\s)${escapeRegExp(triggerPhrase)}([\\s.,!?;:]|$)`, 'gi');
        sanitized = sanitized.replace(regex, '$1the assistant$2');
    }

    return sanitized;
}
