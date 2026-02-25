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
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import {
    estimateTokenCount,
    getTokenCount,
    isTextFile,
    readFileAsBase64,
    readFileAsText,
} from '../utils/chatUtils';
import { logger } from '@/infrastructure/logging/LoggerService';
// ============================================================================
// Types
// ============================================================================

interface IFileProcessResult {
    content?: string;
    attachment?: IChatAttachment;
    error?: string;
}

// ============================================================================
// Constants & Configuration
// ============================================================================

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
        (globalThis as unknown as Record<string, unknown>)['chatFileHandler'] = this;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     */
    public init(): void {
        if (this._initialized) {
            logger.warn('[ChatFileHandler] Already initialized');
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
     * @sideeffect Reads file contents and invokes backend processing
     */
    public async processForSend(
        baseText: string,
    ): Promise<{ attachments: IChatAttachment[]; combinedText: string }> {
        const attachments: IChatAttachment[] = [];
        let combinedText = baseText;

        for (const file of this._files) {
            const result = await this._processSingleFile(file);
            if (result.error !== undefined && result.error !== '') {
                combinedText += result.error;
            }
            if (result.attachment) {
                attachments.push(result.attachment);
            }
            if (result.content !== undefined && result.content !== '') {
                combinedText += result.content;
            }
        }

        // Clear files after processing
        this.clear();
        return { attachments, combinedText };
    }

    /**
     * Internal router for file processing based on environment.
     */
    private _processSingleFile(file: File): Promise<IFileProcessResult> {
        const win = getGlobalWin();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (win.__TAURI__ !== undefined) {
            return this._processWithBackend(file);
        }
        return this._processWithWebFallback(file);
    }

    /**
     * Processes file using Tauri backend commands for efficient extraction.
     */
    private async _processWithBackend(file: File): Promise<IFileProcessResult> {
        try {
            const buffer = await file.arrayBuffer();
            const bytes = Array.from(new Uint8Array(buffer));

            const result = await globalThis.__TAURI__.core.invoke<{
                name: string;
                content: string;
                is_archive: boolean;
                error?: string;
            }>('process_file_content', {
                name: file.name,
                data: bytes,
            });

            if (result.error !== undefined && result.error.length > 0) {
                return { error: `\n[Skipped: ${file.name} - ${result.error}]` };
            }

            if (result.is_archive || result.content.length > 0) {
                return {
                    content: `\n\n${result.content}`,
                    attachment: {
                        name: file.name,
                        type: file.type || (result.is_archive ? 'application/zip' : 'text/plain'),
                        size: file.size,
                        data_base64: '',
                        tokens: 0,
                    },
                };
            }

            if (file.type.startsWith('image/')) {
                const base64 = await readFileAsBase64(file);
                return {
                    content: '',
                    attachment: {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        data_base64: base64,
                        tokens: 258,
                    },
                };
            }

            return { content: '' };
        } catch (e) {
            logger.error(`[ChatFileHandler] Backend processing failed: ${String(e)}`);
            return { error: `\n[Error processing ${file.name}]` };
        }
    }

    /**
     * Web-safe processing for text and images when backend is unavailable.
     */
    private async _processWithWebFallback(file: File): Promise<IFileProcessResult> {
        if (isTextFile(file)) {
            const content = await readFileAsText(file);
            return {
                content: `\n\n--- ${file.name} ---\n${content}`,
                attachment: {
                    name: file.name,
                    type: file.type || 'text/plain',
                    size: file.size,
                    data_base64: '',
                    tokens: estimateTokenCount(content),
                },
            };
        }

        if (file.type.startsWith('image/')) {
            const base64 = await readFileAsBase64(file);
            return {
                content: '',
                attachment: {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data_base64: base64,
                    tokens: 258,
                },
            };
        }

        return { error: `\n[Skipped: ${file.name} - Not supported in Web Mode]` };
    }

    // Removed private ZIP methods (_processZipFile, _extractZipEntries, _validateZipEntry, etc.)

    public async getTotalTokenEstimate(baseText: string): Promise<number> {
        // Simple approximation logic
        let total = await getTokenCount(baseText);
        for (const file of this._files) {
            if (file.type.startsWith('image/')) total += 258;
            // For text files, we rely on backend processing usually.
        }
        return total;
    }

    // calculateCombinedContext also needs update or removal of preview logic
    public calculateCombinedContext(
        baseText: string,
    ): Promise<{ combinedText: string; attachments: IChatAttachment[] }> {
        // Without processing, we can't show "Smart Unpacked".
        // Just show list.
        const attachments: IChatAttachment[] = this._files.map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            data_base64: '',
        }));
        return Promise.resolve({ combinedText: `${baseText}\n[Files attached]`, attachments });
    }

    public async getFileTokenEstimate(file: File): Promise<number> {
        if (file.type.startsWith('image/')) return 258;
        if (isTextFile(file)) {
            try {
                const t = await readFileAsText(file);
                return await getTokenCount(t);
            } catch {
                return 0;
            }
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
}

// Export singleton
export const chatFileHandler = new ChatFileHandler();
