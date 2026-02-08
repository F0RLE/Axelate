import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventBus } from '@/shared/services/EventBus';

describe('EventBus', () => {
    beforeEach(() => {
        eventBus.clear();
    });

    describe('on/emit', () => {
        it('should call handler when event is emitted', () => {
            const handler = vi.fn();
            eventBus.on('page:change', handler);

            eventBus.emit('page:change', { pageId: 'home' });

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({ pageId: 'home' });
        });

        it('should support multiple handlers for same event', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventBus.on('page:change', handler1);
            eventBus.on('page:change', handler2);

            eventBus.emit('page:change', { pageId: 'settings' });

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        it('should not call handler for different event', () => {
            const handler = vi.fn();
            eventBus.on('page:change', handler);

            eventBus.emit('page:ready', { pageId: 'home' });

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('once', () => {
        it('should call handler only once', () => {
            const handler = vi.fn();
            eventBus.once('module:download:complete', handler);

            eventBus.emit('module:download:complete', { moduleId: 'test' });
            eventBus.emit('module:download:complete', { moduleId: 'test2' });

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({ moduleId: 'test' });
        });
    });

    describe('off', () => {
        it('should remove handler', () => {
            const handler = vi.fn();
            eventBus.on('page:change', handler);

            eventBus.off('page:change', handler);
            eventBus.emit('page:change', { pageId: 'home' });

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('unsubscribe function', () => {
        it('should return unsubscribe function from on()', () => {
            const handler = vi.fn();
            const unsubscribe = eventBus.on('page:change', handler);

            unsubscribe();
            eventBus.emit('page:change', { pageId: 'home' });

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('clear', () => {
        it('should clear all handlers for specific event', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventBus.on('page:change', handler1);
            eventBus.on('page:ready', handler2);

            eventBus.clear('page:change');

            eventBus.emit('page:change', { pageId: 'home' });
            eventBus.emit('page:ready', { pageId: 'home' });

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).toHaveBeenCalledTimes(1);
        });

        it('should clear all handlers when no event specified', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            eventBus.on('page:change', handler1);
            eventBus.on('page:ready', handler2);

            eventBus.clear();

            eventBus.emit('page:change', { pageId: 'home' });
            eventBus.emit('page:ready', { pageId: 'home' });

            expect(handler1).not.toHaveBeenCalled();
            expect(handler2).not.toHaveBeenCalled();
        });
    });

    describe('listenerCount', () => {
        it('should return correct count', () => {
            expect(eventBus.listenerCount('page:change')).toBe(0);

            eventBus.on('page:change', () => {});
            expect(eventBus.listenerCount('page:change')).toBe(1);

            eventBus.on('page:change', () => {});
            expect(eventBus.listenerCount('page:change')).toBe(2);
        });
    });

    describe('error handling', () => {
        it('should continue executing other handlers if one throws', () => {
            const errorHandler = vi.fn(() => {
                throw new Error('Test error');
            });
            const successHandler = vi.fn();

            eventBus.on('page:change', errorHandler);
            eventBus.on('page:change', successHandler);

            // Should not throw
            eventBus.emit('page:change', { pageId: 'home' });

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(successHandler).toHaveBeenCalledTimes(1);
        });
    });
});
