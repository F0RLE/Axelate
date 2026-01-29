import iconSvgRaw from './icons/icon.svg?raw';

/**
 * Process SVG string to ensure unique IDs and proper sizing
 */
const getProcessedSvg = (
    svgContent: string,
    idPrefix: string,
    width?: string,
    height?: string,
    className?: string,
): string => {
    let svg = svgContent;

    // 1. Scope IDs to prevent collisions (gradients, masks, etc.)
    // Replace definitions: id="name" -> id="prefix_name"
    svg = svg.replaceAll(/id="([^"]+)"/g, `id="${idPrefix}_$1"`);
    // Replace references: url(#name) -> url(#prefix_name)
    svg = svg.replaceAll(/url\(#([^)]+)\)/g, `url(#${idPrefix}_$1)`);
    // Replace href references: href="#name" -> href="#prefix_name"
    svg = svg.replaceAll(/href="#([^"]+)"/g, `href="#${idPrefix}_$1"`);

    // 2. Inject Classes
    if (className) {
        svg = svg.replace('<svg', `<svg class="${className}"`);
    }

    // 3. Inject Dimensions (Force override if provided)
    if (width || height) {
        // Remove existing width/height to avoid conflicts
        svg = svg.replaceAll(/\s(width|height)="[^"]*"/g, '');
        // Add new Dimensions
        let dims = '';
        if (width) dims += ` width="${width}"`;
        if (height) dims += ` height="${height}"`;
        svg = svg.replace('<svg', `<svg ${dims}`);
    }

    return svg;
};

export const mountLogos = (): void => {
    const splashContainer = document.querySelector<HTMLElement>('.splash-logo-container');
    if (splashContainer && !splashContainer.querySelector('svg')) {
        // Splash Logo: Use original dimensions/viewBox, add class, scope IDs
        const splashSvg = getProcessedSvg(
            iconSvgRaw,
            'splash',
            undefined,
            undefined,
            'splash-logo-svg',
        );

        splashContainer.innerHTML += `
            <div class="splash-glow"></div>
            ${splashSvg}
        `;
    }

    const sidebarLogo = document.querySelector<HTMLElement>('.sidebar-logo-icon');
    if (sidebarLogo && !sidebarLogo.querySelector('svg')) {
        // Sidebar Logo: Force 100% dimensions, scope IDs
        const sidebarSvg = getProcessedSvg(iconSvgRaw, 'sidebar', '100%', '100%');

        sidebarLogo.innerHTML = sidebarSvg;
    }
};

mountLogos();
