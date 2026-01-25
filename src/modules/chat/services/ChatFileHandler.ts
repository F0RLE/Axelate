/**
 * @module chat/services/ChatFileHandler
 * @description State manager for file attachments during a chat session.
 * 
 * @example
 * ```typescript
 * import { chatFileHandler } from './ChatFileHandler';
 * 
 * chatFileHandler.addFiles(fileList);
 * const { attachments, combinedText } = await chatFileHandler.processForSend('Base prompt');
 * ```
 */

import type { IChatAttachment } from '../types/chatTypes';
import { isTextFile, readFileAsText, readFileAsBase64, estimateTokenCount } from '../utils/chatUtils';
import JSZip from 'jszip';

// ============================================================================
// Constants & Configuration
// ============================================================================

const IGNORE_DIRS = ['node_modules/', '.git/', '.svn/', 'dist/', 'build/', '.next/', '.astro/'];
const IGNORE_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
const TEXT_EXTS = new Set([
    'js', 'ts', 'jsx', 'tsx', 'py', 'md', 'json', 'html', 'css', 'txt', 
    'xml', 'yaml', 'yml', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 
    'sql', 'toml', 'env', 'config'
]);

const MAX_ARCHIVE_SIZE = 10 * 1024 * 1024; // 10MB limit for the archive itself
const MAX_EXTRACTED_FILE_SIZE = 50 * 1024; // 50KB limit per extracted file
const MAX_TOTAL_FILES_IN_ZIP = 100; // Max files to process from archive
const MAX_TOTAL_UNCOMPRESSED_SIZE = 100 * 1024 * 1024; // 100MB limit for total expanded data (Zip Bomb protection)

export type AttachmentUpdateCallback = (files: File[], onRemove: (index: number) => void) => void;

/**
 * @class ChatFileHandler
 * @description State manager for file attachments during a chat session.
 */
export class ChatFileHandler {
    private _files: File[] = [];
    private _onUpdate: AttachmentUpdateCallback | null = null;
    private _initialized = false;

    constructor() {
        // Registration on globalThis for access from HTML/legacy code (Section 16.3)
        (globalThis as unknown as Record<string, unknown>).chatFileHandler = this;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Flux Standards.
     */
    public init(): void {
        if (this._initialized) {
            console.warn('[ChatFileHandler] Already initialized');
            return;
        }

        this._initialized = true;
    }

    /**
     * Set callback for when attachments change
     */
    public setUpdateCallback(callback: AttachmentUpdateCallback): void {
        this._onUpdate = callback;
    }

    /**
     * Add files to the attachment list
     * 
     * @param newFiles - File list to add
     * @sideeffect Updates internal state and triggers UI updates if listeners are present
     */
    public addFiles(newFiles: FileList | File[]): void {
        const filesArray = Array.from(newFiles);
        this._files.push(...filesArray);
        this._notifyUpdate();
    }

    /**
     * Remove a file by index
     */
    public removeFile(index: number): void {
        this._files.splice(index, 1);
        this._notifyUpdate();
    }

    /**
     * Clear all files
     */
    public clear(): void {
        this._files = [];
        this._notifyUpdate();
    }

    /**
     * Get current file count
     */
    public getCount(): number {
        return this._files.length;
    }

    /**
     * Check if there are any files
     */
    public hasFiles(): boolean {
        return this._files.length > 0;
    }

    /**
     * Get raw files
     */
    public getFiles(): File[] {
        return [...this._files];
    }

    /**
     * Process files into IChatAttachment format and build combined text for AI context.
     * 
     * @param baseText - The initial message text to append file content to
     * @returns Object containing processed attachments and the final context string
     * @sideeffect Reads file contents and performs archive extraction
     */
    public async processForSend(baseText: string): Promise<{ attachments: IChatAttachment[]; combinedText: string }> {
        const attachments: IChatAttachment[] = [];
        let combinedText = baseText;

        for (const file of this._files) {
            const ext = file.name.split('.').pop()?.toLowerCase();
            const isZip = ext === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

            if (isTextFile(file)) {
                const content = await readFileAsText(file);
                const fileTokens = estimateTokenCount(content);
                combinedText += `\n\n--- ${file.name} ---\n${content}`;
                attachments.push({
                    name: file.name,
                    type: file.type || 'text/plain',
                    size: file.size,
                    data_base64: '', 
                    tokens: fileTokens
                });
            } else if (isZip) {
                const zipResult = await this._processZipFile(file);
                combinedText += zipResult.text;
                attachments.push({
                    ...zipResult.attachment,
                    tokens: zipResult.tokens
                });
            } else {
                const base64 = await readFileAsBase64(file);
                const fileTokens = file.type.startsWith('image/') ? 258 : 0;
                attachments.push({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data_base64: base64,
                    tokens: fileTokens
                });
            }
        }

        // Clear files after processing
        this.clear();
        return { attachments, combinedText };
    }

    /**
     * Helper to process ZIP archives with token optimization.
     */
    private async _processZipFile(file: File): Promise<{ text: string; attachment: IChatAttachment; tokens: number }> {
        if (file.size > MAX_ARCHIVE_SIZE) {
            return {
                text: `\n[Archive skipped: ${file.name} (Size > ${MAX_ARCHIVE_SIZE / 1024 / 1024}MB)]`,
                attachment: {
                    name: file.name,
                    type: file.type || 'application/zip',
                    size: file.size,
                    data_base64: '', 
                },
                tokens: 0
            };
        }

        let textResult = `\n\n--- ARCHIVE: ${file.name} (Smart Unpacked) ---`;
        
        try {
            const zipData = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(zipData);
            const fileNames = Object.keys(zip.files).sort((a, b) => a.localeCompare(b));
            
            // 1. Generate Project Structure Map
            textResult += this._generateStructureMap(zip, fileNames);
            textResult += '\n--- START EXTRACTED FILES ---\n';

            let extractedCount = 0;
            let processedFiles = 0;
            let totalExpandedSize = 0;

            for (const relPath of fileNames) {
                processedFiles++;
                if (processedFiles > MAX_TOTAL_FILES_IN_ZIP) {
                    textResult += `\n[Stopped: File limit exceeded (> ${MAX_TOTAL_FILES_IN_ZIP} files)]`;
                    break;
                }

                if (!this._shouldProcessEntry(relPath, zip.files[relPath].dir)) continue;

                const zipEntry = zip.files[relPath];
                
                // Safety: Path Traversal Protection
                if (relPath.includes('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
                    textResult += `\n[Skipped: ${relPath} - Malformed or suspicious path]`;
                    continue;
                }

                const entryExt = relPath.split('.').pop()?.toLowerCase() || '';

                // Safety: Check uncompressed size (Zip Bomb protection)
                // Use jszp internal metadata if available, otherwise check after extraction
                // @ts-ignore - access internal JSZip metadata for efficiency
                const metadata = zipEntry._data as { uncompressedSize?: number };
                if (metadata?.uncompressedSize && metadata.uncompressedSize > MAX_EXTRACTED_FILE_SIZE * 2) {
                     textResult += `\n[Skipped: ${relPath} - Uncompressed size too large]`;
                     continue;
                }

                const content = await zipEntry.async("string");
                
                // Security: Global Size Check
                totalExpandedSize += content.length;
                if (totalExpandedSize > MAX_TOTAL_UNCOMPRESSED_SIZE) {
                    textResult += `\n\n[CRITICAL: Operation aborted. Total uncompressed size exceeded 100MB limit (Zip Bomb detected).]`;
                    break;
                }

                if (content.length > MAX_EXTRACTED_FILE_SIZE) {
                    textResult += `\n[Skipped: ${relPath} - Content too large (${Math.round(content.length / 1024)}KB)]`;
                    continue;
                }

                textResult += `\n\nFile: ${relPath}\n\`\`\`${entryExt}\n${content}\n\`\`\``;
                extractedCount++;
            }

            if (extractedCount === 0) {
                textResult += `\n(No suitable text files found or all skipped by policy)`;
            }
            
            textResult += `\n--- END ARCHIVE ${file.name} ---`;

            return {
                text: textResult,
                attachment: {
                    name: file.name,
                    type: file.type || 'application/zip',
                    size: file.size,
                    data_base64: '', 
                },
                tokens: estimateTokenCount(textResult)
            };

        } catch (e) {
            console.error('[ChatFileHandler] Failed to optimize zip:', e);
            const base64 = await readFileAsBase64(file);
            return {
                text: '',
                attachment: {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data_base64: base64,
                },
                tokens: 0
            };
        }
    }

    /**
     * Estimates total tokens for current files + base text.
     * 
     * @param baseText - The user message text
     * @returns Estimated token count based on Tiktoken approximation
     */
    public async getTotalTokenEstimate(baseText: string): Promise<number> {
        let total = 0;
        const { combinedText, attachments } = await this.calculateCombinedContext(baseText);
        
        total += estimateTokenCount(combinedText);

        // Add 258 tokens per image
        attachments.forEach(att => {
            if (att.type.startsWith('image/')) {
                total += 258;
            }
        });

        return total;
    }

    /**
     * Internally calculate context without clearing state.
     * Useful for live token estimation and previews.
     * 
     * @param baseText - The user message text
     * @returns Processed attachments and combined text snapshot
     */
    public async calculateCombinedContext(baseText: string): Promise<{ combinedText: string, attachments: IChatAttachment[] }> {
        const tempFiles = [...this._files];
        const attachments: IChatAttachment[] = [];
        let combinedText = baseText;

        for (const file of tempFiles) {
            const ext = file.name.split('.').pop()?.toLowerCase();
            const isZip = ext === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

            if (isTextFile(file)) {
                const content = await readFileAsText(file);
                combinedText += `\n\n--- ${file.name} ---\n${content}`;
                attachments.push({ name: file.name, type: file.type, size: file.size, data_base64: '' });
            } else if (isZip) {
                const res = await this._processZipFile(file);
                combinedText += res.text;
                attachments.push(res.attachment);
            } else {
                attachments.push({ name: file.name, type: file.type, size: file.size, data_base64: 'placeholder' });
            }
        }
        return { combinedText, attachments };
    }

    /**
     * Estimates tokens for a single file.
     * 
     * @param file - The file object to analyze
     * @returns Estimated token count
     */
    public async getFileTokenEstimate(file: File): Promise<number> {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const isZip = ext === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

        if (file.type.startsWith('image/')) {
            return 258;
        }

        if (isTextFile(file)) {
            const content = await readFileAsText(file);
            return estimateTokenCount(content);
        }

        if (isZip) {
            const res = await this._processZipFile(file);
            return estimateTokenCount(res.text);
        }

        return 0;
    }

    /**
     * Notifies UI about updates.
     */
    private _notifyUpdate(): void {
        if (this._onUpdate) {
            this._onUpdate(this._files, this.removeFile.bind(this));
        }
    }

    /**
     * Helper to generate structure map
     */
    private _generateStructureMap(zip: JSZip, fileNames: string[]): string {
        let map = '\n\nStructure Map:\n';
        fileNames.forEach(path => {
            const parts = path.split('/').filter(Boolean);
            const depth = parts.length - 1;
            const prefix = '  '.repeat(depth) + (zip.files[path].dir ? '📁 ' : '📄 ');
            const name = parts.at(-1) || path;
            map += `${prefix}${name}\n`;
        });
        return map;
    }

    /**
     * Determines if a zip entry should be processed for text extraction
     */
    private _shouldProcessEntry(relPath: string, isDir: boolean): boolean {
        if (isDir) return false;

        const isIgnoredDir = IGNORE_DIRS.some(dir => relPath.includes(dir));
        const isIgnoredFile = IGNORE_FILES.some(f => relPath.endsWith(f));
        if (isIgnoredDir || isIgnoredFile) return false;

        const isMinified = relPath.includes('.min.') || relPath.endsWith('.map');
        if (isMinified) return false;

        const entryExt = relPath.split('.').pop()?.toLowerCase() || '';
        return TEXT_EXTS.has(entryExt);
    }
}

// Export singleton
export const chatFileHandler = new ChatFileHandler();
