export interface IAppPage {
    id: string;
    icon: string;
    i18nKey: string;
    defaultLabel: string;
    isBottom?: boolean; // True for bottom menu
    inSettings?: boolean; // True to allow toggling in Settings -> Taskbar Visibility
}

export const APP_PAGES: IAppPage[] = [
    {
        id: 'home',
        icon: '#icon-home',
        i18nKey: 'ui.launcher.web.home',
        defaultLabel: 'Home',
        inSettings: true,
    },
    {
        id: 'chat',
        icon: '#icon-chat',
        i18nKey: 'ui.launcher.web.chat',
        defaultLabel: 'Chat',
        inSettings: true,
    },
    {
        id: 'modules',
        icon: '#icon-folder',
        i18nKey: 'ui.launcher.web.modules',
        defaultLabel: 'Integrations',
        inSettings: true,
    },
    {
        id: 'marketplace',
        icon: '#icon-marketplace',
        i18nKey: 'ui.launcher.web.marketplace',
        defaultLabel: 'Market',
        inSettings: true,
    },
    {
        id: 'settings',
        icon: '#icon-settings',
        i18nKey: 'ui.launcher.web.settings',
        defaultLabel: 'Settings',
        inSettings: false,
    },
    {
        id: 'console',
        icon: '#icon-console',
        i18nKey: 'ui.launcher.web.console',
        defaultLabel: 'Console',
        inSettings: true,
    },
    {
        id: 'downloads',
        icon: '#icon-download',
        i18nKey: 'ui.launcher.web.downloads',
        defaultLabel: 'Downloads',
        isBottom: true,
        inSettings: true,
    },
];
