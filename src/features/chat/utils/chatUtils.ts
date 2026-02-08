/**
 * @module chat/utils/chatUtils
 * @description Utility functions for chat-related operations
 */

import type { TGlobalWin } from '@/shared/types/global_bridge_types';
import { logger } from '@/shared/services/LoggerService';

/**
 * Check if a file is a text-based file.
 */
export function isTextFile(file: File): boolean {
    const textTypes = [
        'text/',
        'application/json',
        'application/javascript',
        'application/x-javascript',
        'application/xml',
        'application/x-sh',
        'application/x-python',
        'application/typescript',
    ];
    const textExts = [
        '.txt',
        '.md',
        '.js',
        '.ts',
        '.py',
        '.html',
        '.css',
        '.json',
        '.xml',
        '.yaml',
        '.yml',
        '.c',
        '.cpp',
        '.h',
        '.rs',
        '.go',
        '.java',
        '.cs',
        '.sh',
        '.bat',
        '.ps1',
        '.ini',
        '.cfg',
        '.conf',
        '.env',
    ];

    if (textTypes.some((t) => file.type.startsWith(t))) return true;
    const name = file.name.toLowerCase();
    return textExts.some((ext) => name.endsWith(ext));
}

/**
 * Read a file as plain text.
 */
export async function readFileAsText(file: File): Promise<string> {
    try {
        return await file.text();
    } catch {
        return '';
    }
}

/**
 * Read a file as a Base64 string.
 */
export function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const res = reader.result;
                const str = typeof res === 'string' ? res : '';
                const b64 = str.includes(',') ? str.split(',')[1] : str;
                resolve(b64 !== undefined && b64 !== '' ? b64 : '');
            } catch {
                resolve('');
            }
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Get a suitable SVG icon based on the file extension.
 */
export function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';

    // Code
    if (
        ['js', 'ts', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'html', 'css', 'json', 'xml'].includes(
            ext,
        )
    ) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>';
    }
    // Image
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    }
    // Text / Doc
    if (['txt', 'md', 'doc', 'docx', 'pdf', 'rtf'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    }
    // Archive
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'ace', 'iso', 'cab'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    }

    // Default File
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
}

/**
 * Estimates the number of tokens in a string using a multilingual heuristic.
 *
 * - English/Latin: ~4 characters per token
 * - Cyrillic: ~2.5 characters per token
 * - CJK (Chinese, Japanese, Korean): ~1.5 tokens per character
 */
export function estimateTokenCount(text: string): number {
    if (text === '') return 0;

    let tokens = 0;

    // 1. CJK characters
    const cjkMatch = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
    if (cjkMatch) {
        tokens += cjkMatch.length * 0.8;
    }

    // 2. Cyrillic characters
    const cyrillicMatch = text.match(/[\u0400-\u04FF]/g);
    if (cyrillicMatch) {
        tokens += cyrillicMatch.length / 2.5;
    }

    // 3. Latin and others
    const otherText = text.replaceAll(
        /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af\u0400-\u04FF]/g,
        '',
    );
    tokens += otherText.length / 4;

    return Math.max(1, Math.ceil(tokens));
}

/**
 * Accurately counts tokens using backend TikToken (if available) or falls back to heuristic.
 */
export async function getTokenCount(text: string, model = 'gpt-4'): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ((globalThis as TGlobalWin).__TAURI__ !== undefined) {
        try {
            return await globalThis.__TAURI__.core.invoke('count_tokens', { text, model });
        } catch (e) {
            logger.warn(`[TokenCount] Backend failed, using heuristic: ${String(e)}`);
        }
    }
    return estimateTokenCount(text);
}
