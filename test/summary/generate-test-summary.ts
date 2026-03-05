import fs from 'fs';
import path from 'path';

const RESULTS_DIR = 'test-results';
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY || 'test-summary.md';

interface TestResult {
    name: string;
    status: 'pass' | 'fail';
    logPath: string;
    failedRepo?: string;
    errorSnippet?: string;
}

function parseLogs(): TestResult[] {
    if (!fs.existsSync(RESULTS_DIR)) {
        return [];
    }

    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.log'));
    const results: TestResult[] = [];

    for (const file of files) {
        const logPath = path.join(RESULTS_DIR, file);
        const content = fs.readFileSync(logPath, 'utf8');
        const testName = file.replace('.log', '');

        const hasPassMarker = content.includes('(pass)');
        const hasFailMarker = content.includes('(fail)');
        const hasRepoWarning = content.includes('⚠️ Keeping failed test repo');
        
        const isFailed = hasFailMarker || hasRepoWarning || (!hasPassMarker && (content.includes('error') || content.includes('failed') || content.includes('HttpError') || content.includes('Exception')));

        let failedRepo: string | undefined;
        const repoMatch = content.match(/⚠️ Keeping failed test repo: (.*)/);
        if (repoMatch) {
            failedRepo = repoMatch[1].trim();
        }

        let errorSnippet: string | undefined;
        let errorLines: string[] = [];
        if (isFailed) {
            const lines = content.split('\n');
            
            const isTaskDescription = (line: string) => line.includes('@junie-agent') || line.includes('Commenting on PR') || line.includes('Waiting for Junie');
            
            if (repoMatch) {
                const repoIndex = lines.findIndex(l => l.includes('⚠️ Keeping failed test repo'));
                if (repoIndex !== -1) {
                    const candidateLines = lines.slice(Math.max(0, repoIndex - 10), repoIndex).filter(l => !isTaskDescription(l) && l.trim() !== '');
                    if (candidateLines.length > 0) {
                        errorLines = candidateLines;
                    }
                }
            }

            if (errorLines.length === 0) {
                errorLines = lines.filter(l => (l.includes('::error') || l.includes('HttpError')) && !isTaskDescription(l));
            }
            
            if (errorLines.length === 0) {
                const failIndex = lines.findIndex(l => l.includes('(fail)'));
                if (failIndex !== -1) {
                    errorLines = lines.slice(Math.max(0, failIndex - 5), failIndex + 2).filter(l => !isTaskDescription(l));
                }
            }

            if (errorLines.length > 0) {
                errorSnippet = errorLines.map(l => l.replace(/^::error.*::/, '').replace(/%0A/g, '\n')).join('\n');
            } else {
                errorSnippet = lines.slice(-10).filter(l => !isTaskDescription(l)).join('\n');
            }
        }

        results.push({
            name: testName,
            status: isFailed ? 'fail' : 'pass',
            logPath,
            failedRepo,
            errorSnippet
        });
    }

    return results;
}

function generateMarkdown(results: TestResult[]): string {
    if (results.length === 0) {
        return "### 🔍 No integration test results found.";
    }

    let md = "### 🧪 Integration Test Summary\n\n";
    
    const passed = results.filter(r => r.status === 'pass');
    const failed = results.filter(r => r.status === 'fail');

    md += `**Total Tests:** ${results.length} | ✅ **Passed:** ${passed.length} | ❌ **Failed:** ${failed.length}\n\n`;

    if (failed.length > 0) {
        md += "#### ❌ Failed Tests Details\n\n";
        for (const res of failed) {
            md += `<details><summary><b>Test:</b> <code>${res.name}</code></summary>\n\n`;
            if (res.failedRepo) {
                md += `**Failing Repo:** \`${res.failedRepo}\`\n\n`;
            }
            if (res.errorSnippet) {
                md += `**Error Context:**\n\`\`\`text\n${res.errorSnippet.trim()}\n\`\`\`\n`;
            }
            md += `</details>\n\n`;
        }
    }

    if (passed.length > 0) {
        md += "<details><summary><b>✅ Passed Tests</b></summary>\n\n";
        for (const res of passed) {
            md += `- ${res.name}\n`;
        }
        md += "</details>\n";
    }

    return md;
}

const results = parseLogs();
const markdown = generateMarkdown(results);

fs.writeFileSync(SUMMARY_FILE, markdown);
console.log(`Summary generated to ${SUMMARY_FILE}`);
