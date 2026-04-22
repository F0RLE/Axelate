/**
 * @module chat/utils/chatUtils
 * @description Utility functions for chat-related operations
 */

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
    const dotIndex = filename.lastIndexOf('.');
    const ext = dotIndex >= 0 ? filename.substring(dotIndex + 1).toLowerCase() : '';

    // Code
    if (
        ['js', 'ts', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'html', 'css', 'json', 'xml'].includes(
            ext,
        )
    ) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM6 16h2v2H6zm2-2h2v2H8zm-2-2h2v2H6z"></path></svg>';
    }
    // Image
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h16v2H4zM2 5h2v14H2zm18 0h2v14h-2zM4 19h16v2H4zM6 7h4v4H6zm8 4h2v2h-2zm2 2h2v2h-2zm-8 2h2v2H8zm2-2h2v2h-2zm2-2h2v2h-2z"></path></svg>';
    }
    // Text / Doc
    if (['txt', 'md', 'doc', 'docx', 'pdf', 'rtf'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8v2H6zm8 2h2v2h-2zm2 2h2v16h-2zM6 20h10v2H6zM4 4h2v16H4zm4 6h6v2H8zm0 4h6v2H8z"></path></svg>';
    }
    // Archive
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'ace', 'iso', 'cab'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v2H4zM2 6h2v12H2zm18 0h2v12h-2zM4 18h16v2H4zm6-10h4v4h-4zm0 4h4v2h-4zm-2 2h8v4H8z"></path></svg>';
    }

    // Default File
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8v2H6zm8 2h2v2h-2zm2 2h2v16h-2zM6 20h10v2H6zM4 4h2v16H4z"></path></svg>';
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
 * Estimates tokens asynchronously.
 * Runtime-specific accurate counting lives outside this helper and should be injected.
 */
export function getTokenCount(text: string, model = 'gpt-4'): Promise<number> {
    void model;
    return Promise.resolve(estimateTokenCount(text));
}
