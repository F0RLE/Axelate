import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationService } from '../modules/core/services/NavigationService';

describe('NavigationService', () => {
    let navService: NavigationService;

    beforeEach(() => {
        // Reset singleton for each test
        // Access private static property for testing
        (NavigationService as unknown as { _instance: NavigationService | null })._instance = null;
        navService = NavigationService.getInstance();
    });

    afterEach(() => {
        // Clean up global
        delete (globalThis as Record<string, unknown>).navigationService;
        delete (globalThis as Record<string, unknown>).navigate;
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const instance1 = NavigationService.getInstance();
            const instance2 = NavigationService.getInstance();

            expect(instance1).toBe(instance2);
        });
    });

    describe('navigate', () => {
        it('should add page to history', () => {
            navService.navigate('home');

            expect(navService.getCurrentPage()).toBe('home');
        });

        it('should update current index', () => {
            navService.navigate('home');
            navService.navigate('settings');

            expect(navService.getCurrentPage()).toBe('settings');
        });

        it('should clear forward history when navigating', () => {
            navService.navigate('home');
            navService.navigate('settings');
            navService.navigate('debug');
            navService.goBack();
            navService.goBack();

            // Now at 'home', forward history has 'settings', 'debug'
            navService.navigate('monitoring');

            // Forward history should be cleared
            navService.goForward();
            expect(navService.getCurrentPage()).toBe('monitoring');
        });
    });

    describe('setCurrentPage', () => {
        it('should navigate and register global functions', () => {
            navService.setCurrentPage('dashboard');

            expect(navService.getCurrentPage()).toBe('dashboard');
            expect((globalThis as Record<string, unknown>).navigationService).toBe(navService);
            expect(typeof (globalThis as Record<string, unknown>).navigate).toBe('function');
        });
    });

    describe('goBack', () => {
        it('should navigate to previous page', () => {
            navService.navigate('home');
            navService.navigate('settings');
            navService.navigate('debug');

            navService.goBack();

            expect(navService.getCurrentPage()).toBe('settings');
        });

        it('should not go back past first page', () => {
            navService.navigate('home');

            navService.goBack();

            expect(navService.getCurrentPage()).toBe('home');
        });

        it('should handle multiple back navigations', () => {
            navService.navigate('page1');
            navService.navigate('page2');
            navService.navigate('page3');

            navService.goBack();
            navService.goBack();

            expect(navService.getCurrentPage()).toBe('page1');
        });
    });

    describe('goForward', () => {
        it('should navigate forward when history exists', () => {
            navService.navigate('home');
            navService.navigate('settings');
            navService.goBack();

            navService.goForward();

            expect(navService.getCurrentPage()).toBe('settings');
        });

        it('should not go forward past last page', () => {
            navService.navigate('home');
            navService.navigate('settings');

            navService.goForward();

            expect(navService.getCurrentPage()).toBe('settings');
        });

        it('should handle back and forward sequence', () => {
            navService.navigate('page1');
            navService.navigate('page2');
            navService.navigate('page3');

            navService.goBack();
            navService.goBack();
            navService.goForward();

            expect(navService.getCurrentPage()).toBe('page2');
        });
    });

    describe('getCurrentPage', () => {
        it('should return undefined when no navigation has occurred', () => {
            // Reset to fresh instance
            (NavigationService as unknown as { _instance: NavigationService | null })._instance =
                null;
            const freshService = NavigationService.getInstance();

            expect(freshService.getCurrentPage()).toBeUndefined();
        });

        it('should return current page after navigation', () => {
            navService.navigate('test-page');

            expect(navService.getCurrentPage()).toBe('test-page');
        });
    });

    describe('refreshFromUiState', () => {
        it('should restore last page from uiState', () => {
            const mockUiState = {
                getLastPage: vi.fn().mockReturnValue('settings'),
            };

            (globalThis as Record<string, unknown>).uiState = mockUiState;

            navService.refreshFromUiState();

            expect(navService.getCurrentPage()).toBe('settings');

            delete (globalThis as Record<string, unknown>).uiState;
        });

        it('should handle missing uiState gracefully', () => {
            // No uiState present
            navService.refreshFromUiState();

            // Should not throw, page should be undefined
            expect(navService.getCurrentPage()).toBeUndefined();
        });

        it('should handle empty last page', () => {
            const mockUiState = {
                getLastPage: vi.fn().mockReturnValue(''),
            };

            (globalThis as Record<string, unknown>).uiState = mockUiState;

            navService.refreshFromUiState();

            // Empty string is falsy, should not add to history
            expect(navService.getCurrentPage()).toBeUndefined();

            delete (globalThis as Record<string, unknown>).uiState;
        });
    });
});
