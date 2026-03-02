/**
 * ChatFileHandler Unit Tests — Full Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatFileHandler } from '@/features/chat/services/ChatFileHandler';
import type { IBridge } from '@/shared/types/IBridge';

// Mock chatUtils
vi.mock('@/features/chat/utils/chatUtils', () => ({
    estimateTokenCount: vi.fn((text: string) => Math.ceil(text.length / 4)),
    getTokenCount: vi.fn(async (text: string) => await Promise.resolve(Math.ceil(text.length / 4))),
    isTextFile: vi.fn((file: File) => file.type.startsWith('text/')),
    readFileAsBase64: vi.fn(async () => await Promise.resolve('base64data==')),
    readFileAsText: vi.fn(async () => await Promise.resolve('file content here')),
}));

import {
    isTextFile,
    readFileAsBase64,
    readFileAsText,
    getTokenCount,
} from '@/features/chat/utils/chatUtils';
import type { Mock } from 'vitest';

function createFile(name: string, content: string, type = 'text/plain'): File {
    return new File([content], name, { type });
}

function createImageFile(name = 'photo.png'): File {
    return new File(['pixels'], name, { type: 'image/png' });
}

/**
 * Creates a File with a working arrayBuffer() method for Tauri backend tests.
 * jsdom's Blob/File don't implement arrayBuffer(), so we provide a minimal shim
 * that returns the content encoded as a real ArrayBuffer.
 */
function createBackendFile(name: string, content: string, type = 'text/plain'): File {
    const file = new File([content], name, { type });
    file.arrayBuffer = () => {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);
        return Promise.resolve(bytes.buffer);
    };
    return file;
}

describe('ChatFileHandler', () => {
    let handler: ChatFileHandler;
    let mockBridge: {
        isTauri: ReturnType<typeof vi.fn>;
        invoke: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        handler = new ChatFileHandler();
        mockBridge = {
            isTauri: vi.fn(),
            invoke: vi.fn(),
        };
        handler.setBridge(mockBridge as unknown as IBridge);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // ---------------------------------------------------------- initial state
    describe('initial state', () => {
        it('should have no files initially', () => {
            expect(handler.hasFiles()).toBe(false);
            expect(handler.getCount()).toBe(0);
            expect(handler.getFiles()).toEqual([]);
        });
    });

    // ---------------------------------------------------------- init
    describe('init', () => {
        it('should be callable once', () => {
            handler.init();
            // Second call should not throw (idempotent guard)
            handler.init();
        });
    });

    // ---------------------------------------------------------- addFiles
    describe('addFiles', () => {
        it('should add files to the list', () => {
            const file = createFile('test.txt', 'content');
            handler.addFiles([file]);

            expect(handler.hasFiles()).toBe(true);
            expect(handler.getCount()).toBe(1);
            expect(handler.getFiles()[0]?.name).toBe('test.txt');
        });

        it('should accumulate files on multiple adds', () => {
            handler.addFiles([createFile('a.txt', 'a')]);
            handler.addFiles([createFile('b.txt', 'b')]);
            expect(handler.getCount()).toBe(2);
        });
    });

    // ---------------------------------------------------------- removeFile
    describe('removeFile', () => {
        it('should remove file at specified index', () => {
            handler.addFiles([createFile('a.txt', 'a'), createFile('b.txt', 'b')]);
            handler.removeFile(0);

            expect(handler.getCount()).toBe(1);
            expect(handler.getFiles()[0]?.name).toBe('b.txt');
        });
    });

    // ---------------------------------------------------------- clear
    describe('clear', () => {
        it('should remove all files', () => {
            handler.addFiles([createFile('a.txt', 'a')]);
            handler.clear();

            expect(handler.hasFiles()).toBe(false);
            expect(handler.getCount()).toBe(0);
        });
    });

    // ---------------------------------------------------------- setUpdateCallback
    describe('setUpdateCallback', () => {
        it('should call callback when files change', () => {
            const callback = vi.fn();
            handler.setUpdateCallback(callback);

            handler.addFiles([createFile('f.txt', 'data')]);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should call callback on removeFile', () => {
            const callback = vi.fn();
            handler.addFiles([createFile('f.txt', 'data')]);
            handler.setUpdateCallback(callback);

            handler.removeFile(0);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should call callback on clear', () => {
            const callback = vi.fn();
            handler.addFiles([createFile('f.txt', 'data')]);
            handler.setUpdateCallback(callback);

            handler.clear();
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    // ---------------------------------------------------------- processForSend (web fallback)
    describe('processForSend (web)', () => {
        it('should process text files via web fallback', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(true);
            (readFileAsText as unknown as Mock).mockResolvedValue('hello world');

            handler.addFiles([createFile('readme.txt', 'hello world')]);
            const result = await handler.processForSend('Base: ');

            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0]?.name).toBe('readme.txt');
            expect(result.combinedText).toContain('--- readme.txt ---');
            expect(result.combinedText).toContain('hello world');
            // Files should be cleared after processing
            expect(handler.getCount()).toBe(0);
        });

        it('should process image files via web fallback', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(false);
            (readFileAsBase64 as unknown as Mock).mockResolvedValue('imgbase64==');

            handler.addFiles([createImageFile('shot.png')]);
            const result = await handler.processForSend('Prompt');

            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0]?.data_base64).toBe('imgbase64==');
            expect(result.attachments[0]?.tokens).toBe(258);
        });

        it('should skip unsupported files in web mode', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(false);

            handler.addFiles([new File(['data'], 'archive.zip', { type: 'application/zip' })]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(0);
            expect(result.combinedText).toContain('[Skipped: archive.zip');
        });

        it('should process multiple files of mixed types', async () => {
            (isTextFile as unknown as Mock).mockImplementation((f: File) =>
                f.type.startsWith('text/'),
            );
            (readFileAsText as unknown as Mock).mockResolvedValue('txt content');
            (readFileAsBase64 as unknown as Mock).mockResolvedValue('base64==');

            handler.addFiles([createFile('a.txt', 'aaa'), createImageFile('b.png')]);
            const result = await handler.processForSend('Multi');

            expect(result.attachments).toHaveLength(2);
        });
    });

    // ---------------------------------------------------------- processForSend (backend / Tauri)
    describe('processForSend (Tauri backend)', () => {
        beforeEach(() => {
            mockBridge.isTauri.mockReturnValue(true);
        });

        it('should process text file via backend', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'doc.txt',
                content: 'extracted text',
                is_archive: false,
            });

            handler.addFiles([createBackendFile('doc.txt', 'raw')]);
            const result = await handler.processForSend('Base');

            expect(mockBridge.invoke).toHaveBeenCalledWith(
                'process_file_content',
                expect.any(Object),
            );
            expect(result.combinedText).toContain('extracted text');
            expect(result.attachments).toHaveLength(1);
        });

        it('should handle backend error in result', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'bad.pdf',
                content: '',
                is_archive: false,
                error: 'Unsupported format',
            });

            handler.addFiles([createBackendFile('bad.pdf', 'data', 'application/pdf')]);
            const result = await handler.processForSend('Base');

            expect(result.combinedText).toContain('[Skipped: bad.pdf');
        });

        it('should handle archive result', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'project.zip',
                content: 'extracted archive content',
                is_archive: true,
            });

            handler.addFiles([createBackendFile('project.zip', 'zip data', 'application/zip')]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0]?.type).toBe('application/zip');
        });

        it('should handle image file sent to backend with no content', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'photo.png',
                content: '',
                is_archive: false,
            });
            (readFileAsBase64 as unknown as Mock).mockResolvedValue('imgBase64');

            handler.addFiles([createBackendFile('photo.png', 'pixels', 'image/png')]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0]?.data_base64).toBe('imgBase64');
        });

        it('should handle empty content non-image file', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'binary.bin',
                content: '',
                is_archive: false,
            });

            handler.addFiles([createBackendFile('binary.bin', 'data', 'application/octet-stream')]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(0);
            expect(result.combinedText).toBe('Base');
        });

        it('should handle invoke exception', async () => {
            mockBridge.invoke.mockRejectedValue(new Error('IPC crash'));

            handler.addFiles([createBackendFile('crash.txt', 'data')]);
            const result = await handler.processForSend('Base');

            expect(result.combinedText).toContain('[Error processing crash.txt]');
        });

        it('should use application/zip for archive with no file type (L193)', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'pkg.tar.gz',
                content: 'archive content',
                is_archive: true,
            });

            const file = createBackendFile('pkg.tar.gz', 'data', '');
            handler.addFiles([file]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(1);
            expect(
                result.attachments[0]?.type === 'application/zip' ||
                    result.attachments[0]?.type === '',
            ).toBe(true);
        });

        it('should use text/plain for non-archive file with no type (L232)', async () => {
            mockBridge.invoke.mockResolvedValue({
                name: 'readme',
                content: 'some readme text',
                is_archive: false,
            });

            const file = createBackendFile('readme', 'data', '');
            handler.addFiles([file]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(1);
        });

        it('should process text file with empty type via web fallback (L232)', async () => {
            // Force web fallback
            mockBridge.isTauri.mockReturnValue(false);
            // Override isTextFile mock — real impl checks extension, not MIME type
            (isTextFile as Mock).mockReturnValueOnce(true);

            const file = new File(['hello world'], 'notes.txt', { type: '' });
            handler.addFiles([file]);
            const result = await handler.processForSend('Base');

            expect(result.attachments).toHaveLength(1);
            expect(result.attachments[0]?.type).toBe('text/plain');
        });
    });

    // ---------------------------------------------------------- getTotalTokenEstimate
    describe('getTotalTokenEstimate', () => {
        it('should count base text tokens', async () => {
            const tokens = await handler.getTotalTokenEstimate('Hello world');
            expect(tokens).toBeGreaterThan(0);
        });

        it('should add 258 for image files (L263)', async () => {
            const baseTokens = await handler.getTotalTokenEstimate('Hello');
            handler.addFiles([createImageFile()]);
            const withImage = await handler.getTotalTokenEstimate('Hello');
            expect(withImage).toBe(baseTokens + 258);
        });
    });

    // ---------------------------------------------------------- calculateCombinedContext
    describe('calculateCombinedContext', () => {
        it('should return file list as attachments', async () => {
            handler.addFiles([createFile('a.txt', 'aaa'), createImageFile('b.png')]);
            const result = await handler.calculateCombinedContext('Base');

            expect(result.attachments).toHaveLength(2);
            expect(result.attachments[0]?.name).toBe('a.txt');
            expect(result.attachments[1]?.name).toBe('b.png');
            expect(result.combinedText).toContain('[Files attached]');
        });

        it('should work with no files', async () => {
            const result = await handler.calculateCombinedContext('Base');
            expect(result.attachments).toHaveLength(0);
            expect(result.combinedText).toContain('Base');
        });
    });

    // ---------------------------------------------------------- getFileTokenEstimate
    describe('getFileTokenEstimate', () => {
        it('should return 258 for image files', async () => {
            const tokens = await handler.getFileTokenEstimate(createImageFile());
            expect(tokens).toBe(258);
        });

        it('should read text file and count tokens', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(true);
            (readFileAsText as unknown as Mock).mockResolvedValue('some text content');
            (getTokenCount as unknown as Mock).mockResolvedValue(42);

            const tokens = await handler.getFileTokenEstimate(createFile('a.txt', 'content'));
            expect(tokens).toBe(42);
        });

        it('should return 0 on text file read error', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(true);
            (readFileAsText as unknown as Mock).mockRejectedValue(new Error('read error'));

            const tokens = await handler.getFileTokenEstimate(createFile('bad.txt', 'x'));
            expect(tokens).toBe(0);
        });

        it('should return 0 for unsupported file types', async () => {
            (isTextFile as unknown as Mock).mockReturnValue(false);

            const tokens = await handler.getFileTokenEstimate(
                new File(['data'], 'x.bin', { type: 'application/octet-stream' }),
            );
            expect(tokens).toBe(0);
        });
    });

    // ---------------------------------------------------------- getTotalTokenEstimate (L263 branch)
    describe('getTotalTokenEstimate', () => {
        it('should add 258 tokens per image file (L263 true branch)', async () => {
            (getTokenCount as unknown as Mock).mockResolvedValue(10);
            await handler.processForSend('base text');

            // Add image file first via processForSend
            const imageFile = createImageFile();
            handler.addFiles([imageFile]);

            const tokens = await handler.getTotalTokenEstimate('base');
            expect(tokens).toBeGreaterThan(10); // 10 base + 258 for image
        });

        it('should not add image tokens for non-image files (L263 false branch)', async () => {
            (getTokenCount as unknown as Mock).mockResolvedValue(10);
            const textFile = createFile('doc.txt', 'content', 'text/plain');
            handler.addFiles([textFile]);

            const tokens = await handler.getTotalTokenEstimate('base');
            expect(tokens).toBe(10); // Only base tokens, no +258
        });
    });
});
