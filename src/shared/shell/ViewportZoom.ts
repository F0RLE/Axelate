const DEFAULT_VIEWPORT_ZOOM = 1;

export function readCssViewportZoom(root: HTMLElement = document.documentElement): number {
    const rawZoom =
        root.style.getPropertyValue('--app-zoom') ||
        globalThis.getComputedStyle(root).getPropertyValue('--app-zoom');
    const zoom = Number.parseFloat(rawZoom);

    return Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_VIEWPORT_ZOOM;
}
