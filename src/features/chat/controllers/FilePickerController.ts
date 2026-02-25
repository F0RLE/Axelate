/**
 * @module chat/controllers/FilePickerController
 * @description Handles file picking (native + web), token counting, and file-to-File conversion.
 * Extracted from ChatController for SRP compliance.
 */

import { chatFileHandler } from '../services/ChatFileHandler';
import { getTokenCount } from '../utils/chatUtils';
import { logger } from '@/infrastructure/logging/LoggerService';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import type { ChatUI } from '../ui/ChatUI';

// Tauri imports — only used at runtime if in Tauri context
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

export class FilePickerController {
    constructor(
        private readonly _i18n: I18nService,
        private readonly _ui: ChatUI,
    ) {}

    /**
     * Entry point for picking files (Native or Web fallback).
     */
    public async pick(): Promise<void> {
        const win = globalThis as { __TAURI_INTERNALS__?: unknown };
        if (win.__TAURI_INTERNALS__ !== undefined) {
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
            chatFileHandler.addFiles(input.files);
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
        const count = await getTokenCount(text);
        this._ui.updateTokenCount(count);
    }

    /**
     * Returns whether the file handler has queued files.
     */
    public hasFiles(): boolean {
        return chatFileHandler.hasFiles();
    }

    /**
     * Returns the file handler singleton for direct access (e.g. processForSend).
     */
    public get handler(): typeof chatFileHandler {
        return chatFileHandler;
    }

    // --- Private helpers ---

    private async _pickNative(): Promise<boolean> {
        try {
            const selected = await open({
                multiple: true,
                title: this._i18n.t('ui.launcher.web.select_files', 'Select Files'),
            });

            if (selected === null) return true;

            const paths = Array.isArray(selected) ? selected : [selected];
            const files: File[] = [];

            for (const p of paths) {
                const file = await this._readNativeFile(p);
                if (file) files.push(file);
            }

            if (files.length > 0) {
                chatFileHandler.addFiles(files);
                void this.updateTokenCount();
            }
            return true;
        } catch (err) {
            logger.error('[FilePickerController] Native file picker failed:', err);
            return false;
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
            logger.error(`[FilePickerController] Failed to read file: ${path}`, err);
            return null;
        }
    }
}
