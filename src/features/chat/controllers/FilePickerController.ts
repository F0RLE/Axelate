/**
 * @module chat/controllers/FilePickerController
 * @description Handles file picking (native + web), token counting, and file-to-File conversion.
 * Extracted from ChatController for SRP compliance.
 */

import type { ChatFileHandler } from '../services/ChatFileHandler';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { ChatUI } from '../ui/ChatUI';

// Tauri imports — only used at runtime if in Tauri context
import { desktopDir, dirname } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

type FilePickerLogger = Pick<LoggerService, 'error' | 'warn'>;

export class FilePickerController {
    private _tokenEstimateRequestId = 0;
    private _lastSelectedDirectory: string | null = null;

    constructor(
        private readonly _i18n: I18nService,
        private readonly _ui: ChatUI,
        private readonly _estimateTokens: (text: string, model?: string) => Promise<number>,
        private readonly _isNativeRuntime: () => boolean,
        private readonly _fileHandler: Pick<
            ChatFileHandler,
            'addFiles' | 'getTotalTokenEstimate' | 'hasFiles'
        >,
        private readonly _tracer: FilePickerLogger,
    ) {}

    /**
     * Entry point for picking files (Native or Web fallback).
     */
    public async pick(): Promise<void> {
        if (this._isNativeRuntime()) {
            const success = await this._pickNative();
            if (success) return;
        }

        const input = document.getElementById('chat-file-input') as HTMLInputElement | null;
        if (input) input.click();
    }

    /**
     * Handles file selection from the HTML file input element.
     */
    public handleFileSelect(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files) {
            this._fileHandler.addFiles(input.files);
            input.value = '';
            void this.updateTokenCount();
        }
    }

    /**
     * Recalculates and updates the token count display.
     */
    public async updateTokenCount(overrideText?: string): Promise<void> {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        const text = overrideText ?? (input ? input.value : '');
        const requestId = ++this._tokenEstimateRequestId;

        try {
            const count = await this._fileHandler.getTotalTokenEstimate(text);
            if (requestId !== this._tokenEstimateRequestId) return;
            this._ui.updateTokenCount(count);
        } catch (error) {
            this._tracer.error('[FilePickerController] Failed to update token count:', error);
            if (requestId !== this._tokenEstimateRequestId) return;
            try {
                const fallbackCount = await this._estimateTokens(text);
                if (requestId !== this._tokenEstimateRequestId) return;
                this._ui.updateTokenCount(fallbackCount);
            } catch (fallbackError) {
                this._tracer.error(
                    '[FilePickerController] Fallback token count failed, using rough estimate:',
                    fallbackError,
                );
                if (requestId !== this._tokenEstimateRequestId) return;
                this._ui.updateTokenCount(Math.max(0, Math.ceil(text.trim().length / 4)));
            }
        }
    }

    /**
     * Returns whether the file handler has queued files.
     */
    public hasFiles(): boolean {
        return this._fileHandler.hasFiles();
    }

    // --- Private helpers ---

    private async _pickNative(): Promise<boolean> {
        try {
            const defaultPath = await this._resolveInitialDirectory();
            const dialogOptions: {
                multiple: boolean;
                title: string;
                defaultPath?: string;
            } = {
                multiple: true,
                title: this._i18n.t('ui.launcher.web.select_files', 'Select Files'),
            };
            if (typeof defaultPath === 'string' && defaultPath !== '') {
                dialogOptions.defaultPath = defaultPath;
            }

            const selected = await open(dialogOptions);

            if (selected !== null) {
                const paths = Array.isArray(selected) ? selected : [selected];
                await this._rememberLastSelectedDirectory(paths);
                const files: File[] = [];

                for (const p of paths) {
                    const file = await this._readNativeFile(p);
                    if (file === null) {
                        continue;
                    }
                    files.push(file);
                }

                if (files.length > 0) {
                    this._fileHandler.addFiles(files);
                    void this.updateTokenCount();
                }
            }
            return true;
        } catch (err) {
            this._tracer.error('[FilePickerController] Native file picker failed:', err);
            return false;
        }
    }

    private async _resolveInitialDirectory(): Promise<string | null> {
        if (this._lastSelectedDirectory !== null && this._lastSelectedDirectory !== '') {
            return this._lastSelectedDirectory;
        }

        try {
            return await desktopDir();
        } catch (err) {
            this._tracer.warn('[FilePickerController] Failed to resolve desktop directory:', err);
            return null;
        }
    }

    private async _rememberLastSelectedDirectory(paths: string[]): Promise<void> {
        const firstPath = paths[0];
        if (firstPath === undefined || firstPath === '') return;

        try {
            this._lastSelectedDirectory = await dirname(firstPath);
        } catch (err) {
            this._tracer.warn(
                `[FilePickerController] Failed to resolve selected directory: ${firstPath}`,
                err,
            );
        }
    }

    private async _readNativeFile(path: string): Promise<File | null> {
        try {
            const data = await readFile(path);
            const name = path.split(/[\\/]/).pop() ?? 'file';
            const ext = name.split('.').pop()?.toLowerCase() ?? '';
            const mimeMap: Record<string, string> = {
                png: 'image/png',
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                gif: 'image/gif',
                webp: 'image/webp',
                svg: 'image/svg+xml',
                txt: 'text/plain',
                md: 'text/markdown',
                json: 'application/json',
                zip: 'application/zip',
            };
            const mime = mimeMap[ext] ?? 'application/octet-stream';
            return new File([data], name, { type: mime });
        } catch (err) {
            this._tracer.error(`[FilePickerController] Failed to read file: ${path}`, err);
            return null;
        }
    }
}
