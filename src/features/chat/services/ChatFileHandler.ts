/**
 * @module chat/services/ChatFileHandler
 * @description State manager for file attachments during a chat session.
 *
 * @example
 * ```typescript
 * import { ChatFileHandler } from './ChatFileHandler';
 *
 * const fileHandler = new ChatFileHandler();
 * fileHandler.addFiles(fileList);
 * const { attachments, combinedText } = await fileHandler.processForSend('Base prompt');
 * ```
 */

import type { IChatAttachment } from '../types/chatTypes';
import type { IBridge } from '@/shared/types/IBridge';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import {
    estimateTokenCount,
    isTextFile,
    readFileAsBase64,
    readFileAsText,
} from '../utils/chatUtils';
// ============================================================================
// Types
// ============================================================================

type ChatFileHandlerLogger = Pick<LoggerService, 'warn' | 'error'>;

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
    private _bridge: IBridge | null = null;
    private _estimateTokens: (text: string, model?: string) => Promise<number> = (text) =>
        Promise.resolve(estimateTokenCount(text));

    constructor(private readonly _tracer: ChatFileHandlerLogger) {}

    public setBridge(bridge: IBridge): void {
        this._bridge = bridge;
    }

    public setTokenEstimator(
        estimateTokens: (text: string, model?: string) => Promise<number>,
    ): void {
        this._estimateTokens = estimateTokens;
    }

    /**
     * Idempotent initialization of the service.
     * Required by Section 16.2 of Axelate Standards.
     */
    public init(): void {
        if (this._initialized) {
            this._tracer.warn('[ChatFileHandler] Already initialized');
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

    public clearUpdateCallback(): void {
        this._onUpdate = null;
    }

    /**
     * Add files to the attachment list
     *
     * @param newFiles - File list to add
     * @sideeffect Updates internal state and triggers UI updates if listeners are present
     */
    public addFiles(newFiles: FileList | File[]): void {
        const filesArray = Array.from(newFiles).filter((file) => file.name !== '');
        if (filesArray.length === 0) return;

        const existingKeys = new Set(this._files.map((file) => this._getFileKey(file)));
        const uniqueFiles = filesArray.filter((file) => {
            const key = this._getFileKey(file);
            if (existingKeys.has(key)) return false;
            existingKeys.add(key);
            return true;
        });

        if (uniqueFiles.length === 0) return;

        this._files.push(...uniqueFiles);
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
        if (this._bridge?.isTauri() === true) {
            return this._processWithBackend(file);
        }
        return this._processWithWebFallback(file);
    }

    /**
     * Processes file using Tauri backend commands for efficient extraction.
     */
    private async _processWithBackend(file: File): Promise<IFileProcessResult> {
        if (!this._bridge) return { error: '\n[Backend unavailable]' };
        try {
            if (this._isImageFile(file)) {
                const base64 = await readFileAsBase64(file);
                return {
                    content: '',
                    attachment: {
                        name: file.name,
                        type: this._resolveImageMime(file),
                        size: file.size,
                        data_base64: base64,
                        tokens: 258,
                    },
                };
            }

            const buffer = await file.arrayBuffer();
            const bytes = Array.from(new Uint8Array(buffer));

            const result = await this._bridge.invoke<{
                name: string;
                content: string;
                is_archive: boolean;
                error?: string;
                token_estimate?: number;
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
                        tokens: result.token_estimate ?? 0,
                    },
                };
            }

            return { content: '' };
        } catch (e) {
            this._tracer.error(`[ChatFileHandler] Backend processing failed: ${String(e)}`);
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

        if (this._isImageFile(file)) {
            const base64 = await readFileAsBase64(file);
            return {
                content: '',
                attachment: {
                    name: file.name,
                    type: this._resolveImageMime(file),
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
        let total = await this._estimateTokens(baseText);
        for (const file of this._files) {
            total += await this.getFileTokenEstimate(file);
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
        if (this._isImageFile(file)) return 258;
        if (this._bridge?.isTauri() === true) {
            try {
                const buffer = await file.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buffer));
                const result = await this._bridge.invoke<{ token_estimate?: number }>(
                    'process_file_content',
                    {
                        name: file.name,
                        data: bytes,
                    },
                );
                return result.token_estimate ?? 0;
            } catch {
                return 0;
            }
        }
        if (isTextFile(file)) {
            try {
                const t = await readFileAsText(file);
                return await this._estimateTokens(t);
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

    private _getFileKey(file: File): string {
        return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    }

    private _isImageFile(file: File): boolean {
        if (file.type.startsWith('image/')) return true;
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension);
    }

    private _resolveImageMime(file: File): string {
        if (file.type.startsWith('image/')) return file.type;
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
        if (extension === 'svg') return 'image/svg+xml';
        if (extension === 'webp') return 'image/webp';
        if (extension === 'gif') return 'image/gif';
        if (extension === 'bmp') return 'image/bmp';
        return 'image/png';
    }
}
