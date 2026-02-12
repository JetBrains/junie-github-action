import {writeFile, mkdir} from "fs/promises";
import {join} from "path";
import mime from "mime-types";
import {JiraAttachment} from "../context";
import {getJiraClient} from "../jira/client";

const DOWNLOAD_DIR = "/tmp/github-attachments";
const JIRA_DOWNLOAD_DIR = "/tmp/jira-attachments";

// Export regex patterns for testing
export const ATTACHMENT_PATTERNS = {
    imgTag: /src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/g,
    markdownImg: /!\[[^\]]*\]\((https:\/\/github\.com\/user-attachments\/assets\/[^)]+)\)/g,
    file: /\((https:\/\/github\.com\/user-attachments\/files\/[^)]+)\)/g,
    legacy: /https:\/\/user-images\.githubusercontent\.com\/[^\s)]+/g
} as const;

/**
 * Extracts authenticated attachment URLs from HTML.
 * bodyHTML contains URLs with short-lived JWT tokens as query parameters.
 * Returns a map of base URL (without query params) -> authenticated URL (with JWT).
 */
function extractAuthenticatedUrls(bodyHTML: string): Map<string, string> {
    const urlMap = new Map<string, string>();

    // Extract URLs from <a> tags (for file attachments)
    const linkPattern = /<a[^>]+href="([^"]*(?:user-attachments|githubusercontent\.com)[^"]*)"[^>]*>/g;
    for (const match of bodyHTML.matchAll(linkPattern)) {
        const fullUrl = match[1];
        const baseUrl = fullUrl.split('?')[0]; // Remove query params to get base URL
        urlMap.set(baseUrl, fullUrl);
    }

    // Extract URLs from <img> tags (for images)
    const imgPattern = /<img[^>]+src="([^"]*(?:user-attachments|githubusercontent\.com)[^"]*)"[^>]*>/g;
    for (const match of bodyHTML.matchAll(imgPattern)) {
        const fullUrl = match[1];
        const baseUrl = fullUrl.split('?')[0];
        urlMap.set(baseUrl, fullUrl);
    }

    return urlMap;
}

async function downloadFile(url: string): Promise<string> {
    const isGitHubUrl = url.includes('github.com') || url.includes('githubusercontent.com');
    const hasTokenInUrl = url.includes('token=') || url.includes('jwt=');

    if (isGitHubUrl && hasTokenInUrl) {
        console.log(`Downloading GitHub attachment with JWT token: ${url.split('?')[0]}`);
    } else if (isGitHubUrl) {
        console.log(`Downloading public GitHub attachment: ${url.split('?')[0]}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url.split('?')[0]}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await mkdir(DOWNLOAD_DIR, {recursive: true});

    let filename = url.split('/').pop() || `attachment-${Date.now()}`;

    // If filename doesn't have extension, try to get it from Content-Type
    if (!filename.includes('.')) {
        const contentType = response.headers.get('content-type');
        if (contentType) {
            const ext = mime.extension(contentType);
            if (ext) {
                filename = `${filename}.${ext}`;
            }
        }
    }

    const localPath = join(DOWNLOAD_DIR, filename);

    await writeFile(localPath, buffer);
    console.log(`✓ Downloaded: ${url} -> ${localPath}`);

    return localPath;
}

/**
 * Downloads all attachments found in text and replaces URLs with local paths.
 *
 * Authentication strategy:
 * - Private repos: Uses JWT tokens from bodyHTML (embedded in URLs as query params)
 * - Public repos: Downloads without authentication
 *
 * Handles:
 * - Image tags: src="https://github.com/user-attachments/assets/..."
 * - Markdown images: ![](https://github.com/user-attachments/assets/...)
 * - Markdown files: (https://github.com/user-attachments/files/...)
 * - Legacy images: https://user-images.githubusercontent.com/...
 *
 * @param text - Text containing attachment URLs (markdown format from body field)
 * @param bodyHTML - HTML version with authenticated URLs containing JWT tokens for private repos
 */
export async function downloadAttachmentsAndRewriteText(text: string, bodyHTML: string): Promise<string> {
    let updatedText = text;

    // Extract authenticated URLs from bodyHTML
    // These URLs contain short-lived JWT tokens required for downloading from private repo
    const authenticatedUrls = extractAuthenticatedUrls(bodyHTML);

    if (authenticatedUrls.size > 0) {
        console.log(`Found ${authenticatedUrls.size} authenticated attachment URLs in bodyHTML`);
    }

    // Helper function to get authenticated URL if available, otherwise return original
    const getAuthenticatedUrl = (url: string): string => {
        const baseUrl = url.split('?')[0]; // Remove any existing query params
        return authenticatedUrls.get(baseUrl) || url;
    };

    // Handle HTML image tags with user-attachments URLs
    const imgMatches = [...text.matchAll(ATTACHMENT_PATTERNS.imgTag)];
    for (const match of imgMatches) {
        const url = match[1];
        try {
            const urlToDownload = getAuthenticatedUrl(url);
            const localPath = await downloadFile(urlToDownload);
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
            const urlToDownload = getAuthenticatedUrl(url);
            const localPath = await downloadFile(urlToDownload);
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
            const urlToDownload = getAuthenticatedUrl(url);
            const localPath = await downloadFile(urlToDownload);
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
            const urlToDownload = getAuthenticatedUrl(url);
            const localPath = await downloadFile(urlToDownload);
            updatedText = updatedText.replace(url, localPath);
        } catch (error) {
            console.error(`Failed to download legacy image: ${url}`, error);
        }
    }

    return updatedText;
}

/**
 * Jira Wiki Markup pattern for attachments: !filename.ext! or !filename.ext|parameters!
 */
export const JIRA_ATTACHMENT_PATTERN = /!([^!|\s]+\.[a-zA-Z0-9]+)(?:\|[^!]*)?!/g;

/**
 * Download a Jira attachment using JiraClient
 */
async function downloadJiraAttachment(url: string, filename: string): Promise<string> {
    const client = getJiraClient();

    const buffer = await client.downloadAttachment(url);

    await mkdir(JIRA_DOWNLOAD_DIR, {recursive: true});

    const localPath = join(JIRA_DOWNLOAD_DIR, filename);

    await writeFile(localPath, buffer);
    console.log(`✓ Downloaded Jira attachment: ${filename} -> ${localPath}`);

    return localPath;
}

/**
 * Downloads Jira attachments referenced in text and replaces wiki markup with local paths.
 *
 * Handles Jira wiki markup: !filename.jpg! or !filename.jpg|width=100,alt="text"!
 *
 * @param text - Text containing Jira wiki markup references
 * @param attachments - Array of Jira attachments with filename and content URL
 * @returns Text with wiki markup replaced by local file paths
 */
export async function downloadJiraAttachmentsAndRewriteText(
    text: string,
    attachments: Array<JiraAttachment>
): Promise<string> {
    if (attachments.length === 0) {
        return text;
    }

    let updatedText = text;

    // Find all Jira wiki markup references: !filename.ext! or !filename.ext|params!
    const matches = [...text.matchAll(JIRA_ATTACHMENT_PATTERN)];

    for (const match of matches) {
        const fullMatch = match[0]; // Full match: !filename.jpg|width=100!
        const filename = match[1];  // Captured filename: filename.jpg

        // Find the attachment by filename
        const attachment = attachments.find(att => att.filename === filename);

        if (attachment) {
            try {
                const localPath = await downloadJiraAttachment(attachment.content, filename);
                // Replace the entire wiki markup with just the local path
                updatedText = updatedText.replace(fullMatch, localPath);
            } catch (error) {
                console.error(`Failed to download Jira attachment: ${filename}`, error);
                // Keep the original markup if download fails
            }
        } else {
            console.warn(`Jira attachment not found: ${filename}`);
        }
    }

    return updatedText;
}
