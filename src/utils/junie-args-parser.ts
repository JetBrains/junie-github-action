/**
 * Extracts junie-args from text and returns cleaned text with extracted arguments
 */
export interface ParsedJunieArgs {
    cleanedText: string;
    args: string[];
}

/**
 * Parses text to extract junie-args in format:
 * junie-args: --model="value" --other-param="value"
 *
 * Can appear anywhere in the text (comment body, custom prompt, etc.)
 */
export function extractJunieArgs(text: string | null | undefined): ParsedJunieArgs {
    if (!text) {
        return { cleanedText: '', args: [] };
    }

    const args: string[] = [];

    // Match junie-args: followed by arguments on the same line or next lines
    // Supports multiline arguments with proper indentation
    const junieArgsPattern = /junie-args:\s*([\s\S]*?)(?=\n(?!\s*--)|$)/gi;

    let cleanedText = text;

    const matches = text.matchAll(junieArgsPattern);
    for (const match of matches) {
        const argsText = match[1].trim();

        if (argsText) {
            // Extract individual arguments (format: --key="value" or --key=value)
            // Supports quoted values with spaces
            const argPattern = /--[\w-]+=(?:"[^"]*"|'[^']*'|[^\s]+)/g;
            const foundArgs = argsText.match(argPattern);

            if (foundArgs) {
                args.push(...foundArgs);
            }
        }

        // Remove the entire junie-args block from text
        cleanedText = cleanedText.replace(match[0], '');
    }

    // Clean up extra whitespace left after removal
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();

    return {
        cleanedText,
        args
    };
}

/**
 * Converts array of junie args to a single command-line string
 */
export function junieArgsToString(args: string[]): string {
    return args.join(' ');
}
