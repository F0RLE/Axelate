import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isTextFile,
    readFileAsText,
    readFileAsBase64,
    getFileIcon,
    estimateTokenCount,
    getTokenCount,
} from './chatUtils';
import { getGlobalWin } from '@/shared/utils/globalAccessor';
import { tracer } from '@/infrastructure/logging/LoggerService';

describe('chatUtils', () => {
    describe('isTextFile', () => {
        it('should return true for known text MIME types', () => {
            const file = new File(['text'], 'file', { type: 'application/json' });
            expect(isTextFile(file)).toBe(true);

            const file2 = new File(['text'], 'file', { type: 'text/plain' });
            expect(isTextFile(file2)).toBe(true);
        });

        it('should return true for known text extensions', () => {
            const file = new File(['code'], 'script.ts', { type: '' });
            expect(isTextFile(file)).toBe(true);

            const file2 = new File(['code'], 'README.md', { type: '' });
            expect(isTextFile(file2)).toBe(true);

            const file3 = new File(['code'], 'config.yml', { type: 'unknown/mime' });
            expect(isTextFile(file3)).toBe(true);
        });

        it('should return false for unknown binary files', () => {
            const file = new File(['bytes'], 'image.png', { type: 'image/png' });
            expect(isTextFile(file)).toBe(false);

            const file2 = new File(['bytes'], 'archive.zip', { type: 'application/zip' });
            expect(isTextFile(file2)).toBe(false);

            const file3 = new File(['bytes'], 'unknown.bin', { type: '' });
            expect(isTextFile(file3)).toBe(false);
        });
    });

    describe('readFileAsText', () => {
        it('should read file content as text', async () => {
            const file = new File(['Hello World'], 'test.txt', { type: 'text/plain' });
            // jsdom doesn't fully support file.text() so we mock it for this test if needed
            if (typeof file.text === 'function') {
                vi.spyOn(file, 'text').mockResolvedValue('Hello World');
            } else {
                file.text = vi.fn().mockResolvedValue('Hello World');
            }
            const result = await readFileAsText(file);
            expect(result).toBe('Hello World');
        });

        it('should return empty string on error', async () => {
            // Mock a file that throws when text() is called
            const file = new File([''], 'test.txt');
            file.text = vi.fn().mockRejectedValue(new Error('Failed to read'));

            const result = await readFileAsText(file);
            expect(result).toBe('');
        });
    });

    describe('readFileAsBase64', () => {
        it('should read file and return base64 part of Data URL', async () => {
            const file = new File(['test'], 'test.txt', { type: 'text/plain' });
            const result = await readFileAsBase64(file);
            // "test" encoded in base64 is dGVzdA==
            expect(result).toBe('dGVzdA==');
        });

        it('should handle non-base64 standard reader result safely', async () => {
            const file = new File(['test'], 'test.txt');
            // Mocking FileReader to manually trigger onload with no comma
            const originalFileReader = globalThis.FileReader;

            class MockFileReader {
                onload: (() => void) | null = null;
                onerror: ((e: Error) => void) | null = null;
                result = 'plainstringwithoutcomma';
                readAsDataURL() {
                    setTimeout(() => {
                        this.onload?.();
                    }, 0);
                }
            }

            globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
            const result = await readFileAsBase64(file);
            expect(result).toBe('plainstringwithoutcomma');

            // Restore
            globalThis.FileReader = originalFileReader;
        });

        it('should return empty string if reader.result is null', async () => {
            const file = new File(['test'], 'test.txt');
            const originalFileReader = globalThis.FileReader;

            class MockFileReader {
                onload: (() => void) | null = null;
                onerror: ((e: Error) => void) | null = null;
                result = null;
                readAsDataURL() {
                    setTimeout(() => {
                        this.onload?.();
                    }, 0);
                }
            }

            globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
            const result = await readFileAsBase64(file);
            expect(result).toBe('');

            // Restore
            globalThis.FileReader = originalFileReader;
        });

        it('should return empty string if reader.result throws error (branch catch)', async () => {
            const file = new File(['test'], 'test.txt');
            const originalFileReader = globalThis.FileReader;

            class MockFileReader {
                onload: (() => void) | null = null;
                onerror: ((e: Error) => void) | null = null;
                get result(): string {
                    throw new Error('Fake Error');
                }
                readAsDataURL() {
                    setTimeout(() => {
                        this.onload?.();
                    }, 0);
                }
            }

            globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
            const result = await readFileAsBase64(file);
            expect(result).toBe('');

            // Restore
            globalThis.FileReader = originalFileReader;
        });

        it('should reject promise on reader error', async () => {
            const file = new File(['test'], 'test.txt');
            const originalFileReader = globalThis.FileReader;

            class MockFileReader {
                onload: (() => void) | null = null;
                onerror: ((e: Error) => void) | null = null;
                readAsDataURL() {
                    setTimeout(() => {
                        if (typeof this.onerror === 'function') {
                            this.onerror(new Error('Reader failed'));
                        }
                    }, 0);
                }
            }

            globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
            await expect(readFileAsBase64(file)).rejects.toThrow('Reader failed');

            // Restore
            globalThis.FileReader = originalFileReader;
        });
    });

    describe('getFileIcon', () => {
        it('should identify code files', () => {
            const icon = getFileIcon('main.ts');
            expect(icon).toContain('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>');
        });

        it('should identify image files', () => {
            const icon = getFileIcon('photo.jpg');
            expect(icon).toContain('<rect x="3" y="3"');
            expect(icon).toContain('<circle cx="8.5"');
        });

        it('should identify document files', () => {
            const icon = getFileIcon('notes.md');
            expect(icon).toContain('<polyline points="14 2 14 8 20 8"/>');
        });

        it('should identify archive files', () => {
            const icon = getFileIcon('backup.zip');
            expect(icon).toContain('<line x1="12" y1="22.08" x2="12" y2="12"/>');
        });

        it('should return default icon for unknown types', () => {
            const icon = getFileIcon('unknown.blob');
            expect(icon).toContain('<path d="M13 2H6a2 2 0 0 0-2 2v16');
        });

        it('should handle extensionless files', () => {
            const icon = getFileIcon('Makefile');
            expect(icon).toContain('<path d="M13 2H6a2 2 0 0 0-2 2v16');
        });

        it('should handle empty filename (L93)', () => {
            const icon = getFileIcon('');
            // Empty string → pop returns '' → no match → default icon
            expect(icon).toContain('<path d="M13 2H6a2 2 0 0 0-2 2v16');
        });
    });

    describe('estimateTokenCount', () => {
        it('should return 0 for empty string', () => {
            expect(estimateTokenCount('')).toBe(0);
        });

        it('should estimate CJK roughly 0.8 tokens per char', () => {
            const text = 'こんにちは'; // 5 chars
            // 5 * 0.8 = 4 => 4 tokens
            expect(estimateTokenCount(text)).toBe(4);
        });

        it('should estimate Cyrillic roughly 1 token per 2.5 chars', () => {
            const text = 'Привет мир'; // 10 chars (9 cyr, 1 space)
            // 9 / 2.5 = 3.6 + 1/4 (0.25) = 3.85 => ceil = 4
            expect(estimateTokenCount(text)).toBe(4);
        });

        it('should estimate Latin roughly 1 token per 4 chars', () => {
            const text = 'Hello world!'; // 12 chars
            // 12 / 4 = 3 => 3 tokens
            expect(estimateTokenCount(text)).toBe(3);
        });

        it('should correctly sum mixed texts', () => {
            const text = 'Hello 你好 Привет';
            // "Hello " (6 char) + "Привет" (6 cyr) + "你好" (2 CJK) + " " (1 char)
            const res = estimateTokenCount(text);
            expect(res).toBeGreaterThan(0);
        });
    });

    describe('getTokenCount', () => {
        let originalWindow: Window & typeof globalThis;
        let tracerSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            originalWindow = globalThis.window;
            (globalThis as unknown as Record<string, unknown>)['window'] = Object.create(
                globalThis.window,
            );
            tracerSpy = vi.spyOn(tracer, 'warn').mockImplementation(() => {
                /* skip log */
            });
        });

        afterEach(() => {
            (globalThis as unknown as Record<string, unknown>)['window'] = originalWindow;
            tracerSpy.mockRestore();
        });

        it('should call tauri invoke if available', async () => {
            const mockInvoke = vi.fn().mockResolvedValue(42);
            const win = getGlobalWin() as unknown as Record<string, unknown>;
            win['__TAURI__'] = {
                core: { invoke: mockInvoke },
            };

            const res = await getTokenCount('Some text', 'gpt-3.5');
            expect(mockInvoke).toHaveBeenCalledWith('count_tokens', {
                text: 'Some text',
                model: 'gpt-3.5',
            });
            expect(res).toBe(42);
        });

        it('should fallback to estimate and trace warning if tauri fails', async () => {
            const mockInvoke = vi.fn().mockRejectedValue('IPC error');
            const win = getGlobalWin() as unknown as Record<string, unknown>;
            win['__TAURI__'] = {
                core: { invoke: mockInvoke },
            };

            const res = await getTokenCount('Hello', 'gpt-4');
            expect(mockInvoke).toHaveBeenCalled();
            expect(tracerSpy).toHaveBeenCalledWith(expect.stringContaining('Backend failed'));
            expect(res).toBeGreaterThan(0); // Should use fallback
        });

        it('should fallback to estimate if tauri is completely unavailable', async () => {
            (getGlobalWin() as unknown as Record<string, unknown>)['__TAURI__'] = undefined;

            const res = await getTokenCount('Hello', 'gpt-4');
            expect(tracerSpy).not.toHaveBeenCalled();
            expect(res).toBe(estimateTokenCount('Hello'));
        });
    });
});
