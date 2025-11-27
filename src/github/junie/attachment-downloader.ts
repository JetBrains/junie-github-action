import {writeFile, mkdir} from "fs/promises";
import {join} from "path";

const DOWNLOAD_DIR = "/tmp/github-attachments";

// Export regex patterns for testing
export const ATTACHMENT_PATTERNS = {
    imgTag: /src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/g,
    markdownImg: /!\[[^\]]*\]\((https:\/\/github\.com\/user-attachments\/assets\/[^)]+)\)/g,
    file: /\((https:\/\/github\.com\/user-attachments\/files\/[^)]+)\)/g,
    legacy: /https:\/\/user-images\.githubusercontent\.com\/[^\s)]+/g
} as const;

async function downloadFile(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await mkdir(DOWNLOAD_DIR, {recursive: true});

    const filename = url.split('/').pop() || `attachment-${Date.now()}`;
    const localPath = join(DOWNLOAD_DIR, filename);

    await writeFile(localPath, buffer);
    console.log(`✓ Downloaded: ${url} -> ${localPath}`);

    return localPath;
}

/**
 * Downloads all attachments found in text and replaces URLs with local paths.
 * Handles:
 * - Image tags: src="https://github.com/user-attachments/assets/..."
 * - Markdown images: ![](https://github.com/user-attachments/assets/...)
 * - Markdown files: (https://github.com/user-attachments/files/...)
 * - Legacy images: https://user-images.githubusercontent.com/...
 */
export async function downloadAttachmentsAndRewriteText(text: string): Promise<string> {
    let updatedText = text;

    // Handle HTML image tags with user-attachments URLs
    const imgMatches = [...text.matchAll(ATTACHMENT_PATTERNS.imgTag)];
    for (const match of imgMatches) {
        const url = match[1];
        try {
            const localPath = await downloadFile(url);
            updatedText = updatedText.replace(match[0], `src="${localPath}"`);
        } catch (error) {
            console.error(`Failed to download image: ${url}`, error);
        }
    }

    // Handle markdown images: ![alt](url)
    const mdImgMatches = [...text.matchAll(ATTACHMENT_PATTERNS.markdownImg)];
    for (const match of mdImgMatches) {
        const url = match[1];
        try {
            const localPath = await downloadFile(url);
            updatedText = updatedText.replace(match[1], localPath);
        } catch (error) {
            console.error(`Failed to download markdown image: ${url}`, error);
        }
    }

    // Handle markdown file links: [text](url)
    const fileMatches = [...text.matchAll(ATTACHMENT_PATTERNS.file)];
    for (const match of fileMatches) {
        const url = match[1];
        try {
            const localPath = await downloadFile(url);
            updatedText = updatedText.replace(match[0], `(${localPath})`);
        } catch (error) {
            console.error(`Failed to download file: ${url}`, error);
        }
    }

    // Handle legacy user-images URLs
    const legacyMatches = [...text.matchAll(ATTACHMENT_PATTERNS.legacy)];
    for (const match of legacyMatches) {
        const url = match[0];
        try {
            const localPath = await downloadFile(url);
            updatedText = updatedText.replace(url, localPath);
        } catch (error) {
            console.error(`Failed to download legacy image: ${url}`, error);
        }
    }

    return updatedText;
}
