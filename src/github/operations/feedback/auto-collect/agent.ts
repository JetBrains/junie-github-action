import {mkdir, writeFile, readFile, unlink} from 'fs/promises';
import {join} from 'path';
import type {AgentFeedbackResult, CollectorVerdict, SessionFeedbackSignals} from './types';


export function buildAgentPrompt(signals: SessionFeedbackSignals, verdict: CollectorVerdict): string {
    const junieComments = signals.comments
        .filter((c) => c.kind === 'summary' || c.kind === 'inline')
        .map((c) => ({
            kind: c.kind,
            path: c.path,
            body: c.body.slice(0, 1500),
            reactions: c.reactions.map((r) => `${r.content} by ${r.userLogin}`),
        }));

    return `You are extracting structured feedback about a Junie code review on a GitHub PR.

Collector already found mixed or text-only signals:
- positive reactions (👍/❤️): ${verdict.thumbsUp}
- negative reactions (👎/😕): ${verdict.thumbsDown}
- reply count: ${verdict.replyTexts.length}

Your job: rate the QUALITY of Junie's code review (not the PR code itself) from 1 (bad) to 5 (excellent).

Return ONLY a single JSON object (no markdown fences) with this exact shape:
{"rating":1,"comment":"short summary of human feedback","confidence":"high|medium|low","rationale":"one sentence"}

Rules:
- Use human replies and reactions as the primary evidence.
- If signals conflict and you cannot decide, set confidence to "low".
- comment must be concise (<= 500 chars) and based on the discussion.
- Do not invent praise or complaints that are not supported by the evidence.

Evidence JSON:
${JSON.stringify({
        sessionId: signals.sessionId,
        runId: signals.runId,
        replies: verdict.replyTexts,
        junieComments,
    }, null, 2)}
`;
}

export function parseAgentFeedbackJson(text: string): AgentFeedbackResult | undefined {
    let searchIndex = 0;
    while (true) {
        const start = text.indexOf('{', searchIndex);
        if (start === -1) break;

        let depth = 0;
        let end = -1;
        let inString = false;
        let escape = false;
        for (let i = start; i < text.length; i++) {
            const char = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (char === '\\' && inString) {
                escape = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === '{') {
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
        }

        if (end !== -1) {
            const candidate = text.slice(start, end + 1);
            if (candidate.includes('"rating"')) {
                try {
                    const parsed = JSON.parse(candidate) as Partial<AgentFeedbackResult>;
                    if (typeof parsed.rating === 'number' && parsed.rating >= 1 && parsed.rating <= 5) {
                        const confidence = parsed.confidence;
                        if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
                            return {
                                rating: parsed.rating,
                                comment: String(parsed.comment || '').slice(0, 500),
                                confidence,
                                rationale: parsed.rationale ? String(parsed.rationale).slice(0, 300) : undefined,
                            };
                        }
                    }
                } catch {
                    // ignore and try next
                }
            }
            searchIndex = start + 1;
        } else {
            break;
        }
    }

    return undefined;
}

export interface RunAgentFeedbackOptions {
    signals: SessionFeedbackSignals;
    verdict: CollectorVerdict;
    workingDir: string;
    cliToken?: string;
    junieFlags?: string;
}

/**
 * Runs Junie CLI with a focused prompt to resolve ambiguous / text-only feedback.
 * Returns undefined if Junie is unavailable or output cannot be parsed.
 */
export async function runAgentFeedbackEnrichment(
    options: RunAgentFeedbackOptions,
): Promise<AgentFeedbackResult | undefined> {
    const { signals, verdict, workingDir, cliToken, junieFlags = '' } = options;
    await mkdir(workingDir, { recursive: true });

    const inputPath = join(workingDir, `auto-collect-input-${signals.sessionId}.json`);
    const outputPath = join(workingDir, `auto-collect-output-${signals.sessionId}.json`);
    const prompt = buildAgentPrompt(signals, verdict);

    const args = [
        '--cache-dir', workingDir,
        '--output-format', 'json',
        '--input-format', 'json',
        '--json-output-file', outputPath,
    ];
    if (cliToken) {
        args.push('--auth', cliToken);
    }
    if (junieFlags.trim()) {
        const matches = junieFlags.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        args.push(...matches.map((arg) => arg.replace(/^([^=]+=)?["'](.*)["']$/, '$1$2')));
    }

    console.log('Running Junie agent enrichment for ambiguous/text-only feedback...');
    try {
        await writeFile(inputPath, JSON.stringify({ task: prompt }, null, 2), 'utf-8');

        const proc = Bun.spawn(['junie', ...args], {
            stdin: Bun.file(inputPath),
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: workingDir,
        });

        const stdoutPromise = new Response(proc.stdout).text();
        const stderrPromise = new Response(proc.stderr).text();

        const exitCode = await proc.exited;
        const stderr = await stderrPromise;

        if (exitCode !== 0) {
            console.warn(`Junie agent enrichment failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
            return undefined;
        }

        let raw: string;
        try {
            raw = await readFile(outputPath, 'utf-8');
        } catch {
            raw = await stdoutPromise;
        }

        let textToParse = raw;
        try {
            const json = JSON.parse(raw) as { result?: string; summary?: string };
            textToParse = json.result || json.summary || raw;
        } catch {
            // use raw
        }

        const parsed = parseAgentFeedbackJson(textToParse);
        if (!parsed) {
            console.warn('Could not parse agent feedback JSON from Junie output');
        }
        return parsed;
    } finally {
        await Promise.all([
            unlink(inputPath).catch(() => {}),
            unlink(outputPath).catch(() => {}),
        ]);
    }
}
