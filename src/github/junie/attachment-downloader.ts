import {writeFile, mkdir} from "fs/promises";
import {join} from "path";
import {JiraAttachment} from "../context";
import {getJiraClient} from "../jira/client";
import mime from "mime-types";

const DOWNLOAD_DIR = "/tmp/github-attachments";
const JIRA_DOWNLOAD_DIR = "/tmp/jira-attachments";

/**
 * Download file from URL (signed or regular)
 * Tries to download without authentication first, falls back to authenticated if needed
 */
async function downloadFile(url: string, originalUrl: string): Promise<string> {
    // Try downloading with follow redirects
    const response = await fetch(url, {
        redirect: 'follow',
        headers: {
            'User-Agent': 'junie-github-action'
        }
    });

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
 * Extract all GitHub attachments from HTML and map to download URLs
 * Returns map: originalUrl -> downloadUrl (signed URL if available, otherwise original URL)
 */
function extractAttachmentsFromHtml(bodyHtml: string): Map<string, string> {
    const urlMap = new Map<string, string>();

    // Find all signed URLs (images with JWT tokens)
    const signedUrlRegex = /https:\/\/private-user-images\.githubusercontent\.com\/[^"]+\?jwt=[^"]+/g;
    const signedMatches = [...bodyHtml.matchAll(signedUrlRegex)];
    const fileIdToSignedUrl = new Map<string, string>();

    for (const match of signedMatches) {
        const signedUrl = match[0];

        // Extract file ID from signed URL (between last / and ?jwt)
        const fileIdMatch = signedUrl.match(/\/([^/]+)\?jwt=/);
        if (fileIdMatch) {
            const fileIdWithExt = fileIdMatch[1]; // e.g., "548975708-79533cdb-b822-48ec-a58c-9b2d1cb0eabc.png"
            const fileId = fileIdWithExt.replace(/\.\w+$/, ''); // Remove extension

            // Store both full ID and UUID-only variant
            fileIdToSignedUrl.set(fileId, signedUrl);

            // Also store UUID-only variant (without numeric prefix)
            const uuidOnly = fileId.replace(/^\d+-/, '');
            if (uuidOnly !== fileId) {
                fileIdToSignedUrl.set(uuidOnly, signedUrl);
            }
        }
    }

    // Find all original attachment URLs (what appears in markdown/HTML content)
    const attachmentUrlRegex = /https:\/\/github\.com\/user-attachments\/(assets|files)\/[^"'\s)]+/g;
    const attachmentMatches = [...bodyHtml.matchAll(attachmentUrlRegex)];

    for (const match of attachmentMatches) {
        const originalUrl = match[0];
        const fileIdFromUrl = originalUrl.split('/').pop();

        if (!fileIdFromUrl) continue;

        // Check if we have a signed URL for this file ID
        const downloadUrl = fileIdToSignedUrl.get(fileIdFromUrl) || originalUrl;
        urlMap.set(originalUrl, downloadUrl);
    }

    console.log(`Total attachments found: ${urlMap.size}`);

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
 * @param bodyHtml - HTML body from GitHub API (with signed URLs for images)
 * @returns Map of original URLs to local file paths
 */
export async function downloadAttachmentsFromHtml(bodyHtml: string): Promise<Map<string, string>> {
    // Extract all attachments (with signed URLs if available)
    const attachmentsMap = extractAttachmentsFromHtml(bodyHtml);

    if (attachmentsMap.size === 0) {
        return new Map();
    }

    const downloadedUrlsMap = new Map<string, string>();

    // Download all attachments (try signed URL if available, otherwise regular URL)
    for (const [originalUrl, downloadUrl] of attachmentsMap) {
        try {
            const localPath = await downloadFile(downloadUrl, originalUrl);
            downloadedUrlsMap.set(originalUrl, localPath);
        } catch (error) {
            console.warn(`Could not download ${originalUrl}: ${error instanceof Error ? error.message : error}`);
            // Continue with other attachments
        }
    }

    if (downloadedUrlsMap.size > 0) {
        console.log(`Successfully downloaded ${downloadedUrlsMap.size} attachment(s)`);
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
