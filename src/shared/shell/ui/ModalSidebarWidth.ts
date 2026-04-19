export function updateModalSidebarWidth(sidebar: HTMLElement): void {
    const spans = Array.from(sidebar.querySelectorAll<HTMLElement>('.category-filter-btn span'));
    let maxTextWidth = 0;

    spans.forEach((span) => {
        if (span.scrollWidth > maxTextWidth) {
            maxTextWidth = span.scrollWidth;
        }
    });

    if (maxTextWidth <= 0) {
        return;
    }

    const expandedButtonWidth = 44 + 12 + maxTextWidth + 16;
    const expandedSidebarWidth = Math.max(160, expandedButtonWidth + 24);

    sidebar.style.setProperty('--sidebar-expanded-width', `${expandedSidebarWidth.toString()}px`);
    sidebar.style.setProperty('--filter-btn-expanded-width', `${expandedButtonWidth.toString()}px`);
}
