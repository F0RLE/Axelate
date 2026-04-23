type SidebarMonitorElements = {
    monitor: HTMLElement;
    sidebar: HTMLElement;
    logo: HTMLElement;
    menu: HTMLElement;
    bottom: HTMLElement;
};

type SidebarMonitorLogger = {
    debug: (message: string) => void;
};

export class SidebarMonitorVisibilityController {
    private _minMonitorHeight = 0;

    constructor(private readonly _tracer: SidebarMonitorLogger) {}

    public prime(elements: SidebarMonitorElements): void {
        this._minMonitorHeight = elements.monitor.offsetHeight || 300;
    }

    public update(elements: SidebarMonitorElements): void {
        const sidebarHeight = elements.sidebar.clientHeight;
        const requiredSpace = this._calculateRequiredSpace(elements);
        const overflowAllowancePx = Math.max(32, Math.round(elements.bottom.offsetHeight * 0.6));
        const spaceDeficit = requiredSpace - sidebarHeight;
        const overflowAmount = Math.max(0, elements.sidebar.scrollHeight - sidebarHeight);
        const isVisible = !elements.monitor.classList.contains('adaptive-hidden');

        if (
            isVisible &&
            (spaceDeficit > overflowAllowancePx || overflowAmount > overflowAllowancePx)
        ) {
            elements.monitor.classList.add('adaptive-hidden');
            elements.sidebar.classList.add('monitor-hidden');
            this._tracer.debug('[SidebarUI] Hiding monitor due to overflow or insufficient space');
            return;
        }

        if (
            !isVisible &&
            spaceDeficit <= overflowAllowancePx / 2 &&
            overflowAmount <= overflowAllowancePx / 2
        ) {
            elements.monitor.classList.remove('adaptive-hidden');
            elements.sidebar.classList.remove('monitor-hidden');
            this._tracer.debug('[SidebarUI] Showing monitor (space restored)');
        }
    }

    private _calculateRequiredSpace(elements: SidebarMonitorElements): number {
        const paddingAndMargins = 24 * 4;
        const autoMarginBuffer = 20;

        return (
            elements.logo.offsetHeight +
            elements.menu.offsetHeight +
            elements.bottom.offsetHeight +
            this._minMonitorHeight +
            paddingAndMargins +
            autoMarginBuffer
        );
    }
}
