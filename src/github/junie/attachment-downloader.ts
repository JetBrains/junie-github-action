import {writeFile, mkdir} from "fs/promises";
import {join} from "path";
import {JiraAttachment} from "../context";
import {getJiraClient} from "../jira/client";
import mime from "mime-types";

const DOWNLOAD_DIR = "/tmp/github-attachments";
const JIRA_DOWNLOAD_DIR = "/tmp/jira-attachments";

/**
 * Download file from a signed URL (no authentication needed)
 */
async function downloadFileFromSignedUrl(signedUrl: string, originalUrl: string): Promise<string> {
    const response = await fetch(signedUrl);
    if (!response.ok) {
        throw new Error(`Failed to download ${originalUrl}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await mkdir(DOWNLOAD_DIR, {recursive: true});

    let filename = originalUrl.split('/').pop() || `attachment-${Date.now()}`;

    // If filename doesn't have extension, try to get it from Content-Type header
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
    console.log(`✓ Downloaded: ${originalUrl} -> ${localPath}`);

    return localPath;
}

/**
 * Extract signed URLs from HTML and map them to original URLs
 */
function extractSignedUrlsFromHtml(bodyHtml: string): Map<string, string> {
    const urlMap = new Map<string, string>();

    // Extract signed URLs from HTML
    const signedUrlRegex = /https:\/\/private-user-images\.githubusercontent\.com\/[^"'\s]+\?jwt=[^"'\s]+/g;
    const signedUrls = bodyHtml.match(signedUrlRegex) || [];

    // Extract original URLs from HTML (both in markdown and HTML img tags)
    const originalUrlRegex = /https:\/\/github\.com\/user-attachments\/(assets|files)\/[^"'\s)]+/g;
    const originalUrls = bodyHtml.match(originalUrlRegex) || [];

    // Map original URLs to signed URLs (they appear in the same order in HTML)
    for (let i = 0; i < Math.min(originalUrls.length, signedUrls.length); i++) {
        const original = originalUrls[i];
        const signed = signedUrls[i];
        if (original && signed) {
            urlMap.set(original, signed);
        }
    }

    return urlMap;
}

/**
 * Replace attachment URLs in text with local paths
 */
function replaceAttachmentUrls(text: string, downloadedUrlsMap: Map<string, string>): string {
    let updatedText = text;

    for (const [originalUrl, localPath] of downloadedUrlsMap) {
        // Handle HTML image tags
        const imgPattern = new RegExp(`src="${originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
        updatedText = updatedText.replace(imgPattern, `src="${localPath}"`);

        // Handle markdown images and file links
        const mdPattern = new RegExp(originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        updatedText = updatedText.replace(mdPattern, localPath);
    }

    return updatedText;
}

/**
 * Download attachments from HTML and get a map of original URLs to local paths.
 *
 * @param bodyHtml - HTML body from GitHub API (with signed URLs)
 * @returns Map of original URLs to local file paths
 */
export async function downloadAttachmentsFromHtml(bodyHtml: string): Promise<Map<string, string>> {
    // Extract signed URLs from HTML
    const signedUrlsMap = extractSignedUrlsFromHtml(bodyHtml);

    if (signedUrlsMap.size === 0) {
        return new Map();
    }

    const downloadedUrlsMap = new Map<string, string>();

    // Download all attachments using signed URLs
    for (const [originalUrl, signedUrl] of signedUrlsMap) {
        try {
            const localPath = await downloadFileFromSignedUrl(signedUrl, originalUrl);
            downloadedUrlsMap.set(originalUrl, localPath);
        } catch (error) {
            console.error(`Failed to download ${originalUrl}:`, error);
        }
    }

    if (downloadedUrlsMap.size > 0) {
        console.log(`Downloaded ${downloadedUrlsMap.size} attachment(s)`);
    }

    return downloadedUrlsMap;
}

/**
 * Helper function to replace attachment URLs in text with local paths
 */
export function replaceAttachmentsInText(text: string, urlMap: Map<string, string>): string {
    return replaceAttachmentUrls(text, urlMap);
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
