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

    // First, find all attachments with signed URLs
    const signedUrlRegex = /https:\/\/private-user-images\.githubusercontent\.com\/[^"]+\?jwt=[^"]+/g;
    const signedMatches = [...bodyHtml.matchAll(signedUrlRegex)];

    // Then, find all regular attachment URLs (files, or images without signed URLs)
    const attachmentUrlRegex = /https:\/\/github\.com\/user-attachments\/(assets|files)\/[^"'\s)]+/g;
    const attachmentMatches = [...bodyHtml.matchAll(attachmentUrlRegex)];

    for (const match of signedMatches) {
        const signedUrl = match[0];

        // Extract filename from signed URL
        // Format: https://private-user-images.githubusercontent.com/123456/filename.ext?jwt=...
        const urlWithoutQuery = signedUrl.split('?')[0];
        const filename = urlWithoutQuery.split('/').pop();

        if (!filename) continue;

        // Remove file extension to get file ID
        const fileId = filename.replace(/\.[^.]+$/, '');

        // Construct original URL from file ID
        const originalUrl = `https://github.com/user-attachments/assets/${fileId}`;

        urlMap.set(originalUrl, signedUrl);
    }

    for (const match of attachmentMatches) {
        const url = match[0];

        // Only add if we don't already have a signed URL for this attachment
        if (!urlMap.has(url)) {
            urlMap.set(url, url); // Use original URL as download URL
        }
    }

    if (urlMap.size > 0) {
        console.log(`Found ${urlMap.size} attachment(s) in HTML`);
    }

    return urlMap;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace attachment URLs in text with local paths
 * Finds all GitHub attachment URLs in text and matches them with downloaded files by file ID
 */
function replaceAttachmentUrls(text: string, downloadedUrlsMap: Map<string, string>): string {
    let updatedText = text;

    // Find all GitHub attachment URLs in the text
    const attachmentRegex = /https:\/\/github\.com\/user-attachments\/(assets|files)\/[^\s)">]+/g;
    const urlsInText = [...text.matchAll(attachmentRegex)].map(match => match[0]);

    for (const urlInText of urlsInText) {
        // Extract file ID from URL (last part after /)
        const fileIdInText = urlInText.split('/').pop();
        if (!fileIdInText) continue;

        // Try to find matching downloaded file
        let localPath: string | undefined;

        // First, try exact match
        if (downloadedUrlsMap.has(urlInText)) {
            localPath = downloadedUrlsMap.get(urlInText);
        } else {
            // Try matching by file ID (handles both with and without numeric prefix)
            for (const [downloadedUrl, downloadedPath] of downloadedUrlsMap) {
                const fileIdDownloaded = downloadedUrl.split('/').pop();
                if (!fileIdDownloaded) continue;

                if (fileIdDownloaded.includes(fileIdInText)) {
                    localPath = downloadedPath;
                    break;
                }
            }
        }

        // Replace URL with local path if found
        if (localPath) {
            const escapedUrl = escapeRegex(urlInText);
            updatedText = updatedText.replace(new RegExp(escapedUrl, 'g'), localPath);
        }
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
