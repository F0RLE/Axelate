import { describe, expect, it, vi } from 'vitest';

import { initializeImmediateUi } from './CoreRuntimeSupport';

describe('CoreRuntimeSupport', () => {
    it('should restore sidebar first and then resync the active page button', async () => {
        const callOrder: string[] = [];
        const navigation = {
            getCurrentPage: vi.fn(() => 'settings'),
        };
        const sidebarUI = {
            init: vi.fn(() => {
                callOrder.push('sidebar:init');
            }),
        };
        const navigationUI = {
            init: vi.fn(() => {
                callOrder.push('navigation:init');
            }),
            showPage: vi.fn(() => {
                callOrder.push('navigation:showPage');
            }),
        };
        const moduleService = {
            init: vi.fn(() => {
                callOrder.push('module:init');
            }),
        };
        const downloadUI = {
            init: vi.fn(() => {
                callOrder.push('download:init');
            }),
        };

        await initializeImmediateUi({
            navigation: navigation as never,
            navigationUI: navigationUI as never,
            downloadUI: downloadUI as never,
            moduleService: moduleService as never,
            sidebarUI: sidebarUI as never,
        });

        expect(sidebarUI.init).toHaveBeenCalledTimes(1);
        expect(navigationUI.init).toHaveBeenCalledTimes(1);
        expect(navigationUI.showPage).toHaveBeenCalledWith('settings', null, true, true);
        expect(callOrder).toEqual([
            'sidebar:init',
            'navigation:init',
            'navigation:showPage',
            'module:init',
            'download:init',
        ]);
    });

    it('should fall back to home when navigation has no current page', async () => {
        const navigation = {
            getCurrentPage: vi.fn(() => undefined),
        };
        const sidebarUI = {
            init: vi.fn(() => {}),
        };
        const navigationUI = {
            init: vi.fn(() => {}),
            showPage: vi.fn(() => {}),
        };
        const moduleService = {
            init: vi.fn(() => {}),
        };
        const downloadUI = {
            init: vi.fn(() => {}),
        };

        await initializeImmediateUi({
            navigation: navigation as never,
            navigationUI: navigationUI as never,
            downloadUI: downloadUI as never,
            moduleService: moduleService as never,
            sidebarUI: sidebarUI as never,
        });

        expect(navigationUI.showPage).toHaveBeenCalledWith('home', null, true, true);
    });
});
