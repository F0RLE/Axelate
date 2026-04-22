import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationService } from '@/infrastructure/navigation/NavigationService';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';

describe('NavigationService', () => {
    let navService: NavigationService;
    let tracer: LoggerService;

    beforeEach(() => {
        tracer = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as LoggerService;
        navService = new NavigationService(tracer);
    });

    afterEach(() => {
        // Clean up global
        const win = globalThis as unknown as Record<string, unknown>;
        delete win['navigationService'];
        delete win['navigate'];
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
            navService.navigate('console');
            navService.goBack();
            navService.goBack();

            // Now at 'home', forward history has 'settings', 'console'
            navService.navigate('monitoring');

            // Forward history should be cleared
            navService.goForward();
            expect(navService.getCurrentPage()).toBe('monitoring');
        });
    });

    describe('setCurrentPage', () => {
        it('should navigate', () => {
            navService.setCurrentPage('dashboard');

            expect(navService.getCurrentPage()).toBe('dashboard');
        });
    });

    describe('goBack', () => {
        it('should navigate to previous page', () => {
            navService.navigate('home');
            navService.navigate('settings');
            navService.navigate('console');

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
            const freshService = new NavigationService(tracer);

            expect(freshService.getCurrentPage()).toBeUndefined();
        });

        it('should return current page after navigation', () => {
            navService.navigate('test-page');

            expect(navService.getCurrentPage()).toBe('test-page');
        });
    });

    describe('refreshFromUiState', () => {
        it('should restore last page from uiState', () => {
            navService.refreshFromUiState('settings');

            expect(navService.getCurrentPage()).toBe('settings');
        });

        it('should handle missing uiState gracefully', () => {
            navService.refreshFromUiState();

            expect(navService.getCurrentPage()).toBeUndefined();
        });

        it('should handle empty last page', () => {
            navService.refreshFromUiState('');

            expect(navService.getCurrentPage()).toBeUndefined();
        });

        it('should handle uiState with non-string last_page gracefully (Line 40)', () => {
            navService.refreshFromUiState(null);

            expect(navService.getCurrentPage()).toBeUndefined();
        });

        it('should handle uiState existing but without last_page property (Line 40)', () => {
            navService.refreshFromUiState();

            expect(navService.getCurrentPage()).toBeUndefined();
        });
    });

    describe('setCurrentPage with isHistoryNav', () => {
        it('should not modify history stack when isHistoryNav is true', () => {
            navService.navigate('home');
            navService.setCurrentPage('settings', true);
            expect(navService.getCurrentPage()).toBe('home');
        });

        it('should update UISettingsService last page when isHistoryNav is true', () => {
            const mockUiSettings = { setLastPage: vi.fn() };
            navService.setUISettingsService(
                mockUiSettings as unknown as Parameters<typeof navService.setUISettingsService>[0],
            );
            navService.navigate('home');
            navService.setCurrentPage('settings', true);
            expect(mockUiSettings.setLastPage).toHaveBeenCalledWith('settings');
        });
    });

    describe('setUISettingsService', () => {
        it('should persist page via UISettingsService on navigate', () => {
            const mockUiSettings = { setLastPage: vi.fn() };
            navService.setUISettingsService(
                mockUiSettings as unknown as Parameters<typeof navService.setUISettingsService>[0],
            );
            navService.navigate('dashboard');
            expect(mockUiSettings.setLastPage).toHaveBeenCalledWith('dashboard');
        });
    });

    describe('pushBackAction', () => {
        it('should push action with forwardAction', () => {
            const action = vi.fn();
            const forwardAction = vi.fn();
            navService.pushBackAction('modal', action, forwardAction);
            const result = navService.popBackAction();
            expect(result).toBe(true);
            expect(action).toHaveBeenCalled();
        });

        it('should deduplicate by id', () => {
            const action1 = vi.fn();
            const action2 = vi.fn();
            navService.pushBackAction('modal', action1);
            navService.pushBackAction('modal', action2);
            navService.popBackAction();
            expect(action1).not.toHaveBeenCalled();
            expect(action2).toHaveBeenCalled();
        });
    });

    describe('removeBackAction', () => {
        it('should remove action by id', () => {
            navService.pushBackAction('modal', vi.fn());
            navService.removeBackAction('modal');
            expect(navService.popBackAction()).toBe(false);
        });

        it('should do nothing when id not found', () => {
            navService.removeBackAction('nonexistent');
            expect(navService.popBackAction()).toBe(false);
        });
    });

    describe('popBackAction with forward', () => {
        it('should push to forward stack when forwardAction exists', () => {
            const forwardAction = vi.fn();
            navService.pushBackAction('modal', vi.fn(), forwardAction);
            navService.popBackAction();
            // Now forward action should be in forward stack
            const result = navService.popForwardAction();
            expect(result).toBe(true);
            expect(forwardAction).toHaveBeenCalled();
        });

        it('should return false when no actions', () => {
            expect(navService.popBackAction()).toBe(false);
        });

        it('should not push to forward stack when forwardAction is undefined (Line 154)', () => {
            navService.pushBackAction('modal', vi.fn());
            navService.popBackAction();
            // forwardAction is undefined, so forward stack should be empty
            const result = navService.popForwardAction();
            expect(result).toBe(false);
        });

        it('should return false when actionInfo is falsy (Line 154)', () => {
            // Unrealistic in normal usage due to TS types, but good for defensive coverage
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (navService as any)._actionStack.push(undefined);
            expect(navService.popBackAction()).toBe(false);
        });
    });

    describe('popForwardAction', () => {
        it('should return false when forward stack empty', () => {
            expect(navService.popForwardAction()).toBe(false);
        });

        it('should return false when forward stack pops undefined/null (Line 178)', () => {
            // Unrealistic in normal usage due to TS types, but good for defensive coverage
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (navService as any)._forwardActionStack.push(undefined);
            expect(navService.popForwardAction()).toBe(false);
        });
    });

    describe('clearForwardActions', () => {
        it('should clear forward actions stack', () => {
            const forwardAction = vi.fn();
            navService.pushBackAction('modal', vi.fn(), forwardAction);
            navService.popBackAction();
            navService.clearForwardActions();
            expect(navService.popForwardAction()).toBe(false);
        });

        it('should do nothing when already empty', () => {
            navService.clearForwardActions();
            expect(navService.popForwardAction()).toBe(false);
        });
    });
});
