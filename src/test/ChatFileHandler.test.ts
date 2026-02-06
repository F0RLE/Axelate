/**
 * ChatFileHandler Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatFileHandler } from '../modules/chat/services/ChatFileHandler';

describe('ChatFileHandler', () => {
    let handler: ChatFileHandler;

    beforeEach(() => {
        handler = new ChatFileHandler();
    });

    describe('initial state', () => {
        it('should have no files initially', () => {
            expect(handler.hasFiles()).toBe(false);
            expect(handler.getCount()).toBe(0);
            expect(handler.getFiles()).toEqual([]);
        });
    });

    describe('addFiles', () => {
        it('should add files to the list', () => {
            const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
            handler.addFiles([mockFile]);

            expect(handler.hasFiles()).toBe(true);
            expect(handler.getCount()).toBe(1);
            expect(handler.getFiles()[0]?.name).toBe('test.txt');
        });

        it('should accumulate files on multiple adds', () => {
            const file1 = new File(['a'], 'file1.txt', { type: 'text/plain' });
            const file2 = new File(['b'], 'file2.txt', { type: 'text/plain' });

            handler.addFiles([file1]);
            handler.addFiles([file2]);

            expect(handler.getCount()).toBe(2);
        });
    });

    describe('removeFile', () => {
        it('should remove file at specified index', () => {
            const file1 = new File(['a'], 'file1.txt', { type: 'text/plain' });
            const file2 = new File(['b'], 'file2.txt', { type: 'text/plain' });

            handler.addFiles([file1, file2]);
            handler.removeFile(0);

            expect(handler.getCount()).toBe(1);
            expect(handler.getFiles()[0]?.name).toBe('file2.txt');
        });
    });

    describe('clear', () => {
        it('should remove all files', () => {
            const file1 = new File(['a'], 'file1.txt', { type: 'text/plain' });
            handler.addFiles([file1]);

            handler.clear();

            expect(handler.hasFiles()).toBe(false);
            expect(handler.getCount()).toBe(0);
        });
    });

    describe('setUpdateCallback', () => {
        it('should call callback when files change', () => {
            const callback = vi.fn();
            handler.setUpdateCallback(callback);

            const file = new File(['a'], 'file.txt', { type: 'text/plain' });
            handler.addFiles([file]);

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });
});
