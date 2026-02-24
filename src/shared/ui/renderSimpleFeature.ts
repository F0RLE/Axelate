import DOMPurify from 'dompurify';
import type { TGlobalWin } from '@/shared/types/global_bridge_types';

export const renderSimpleFeature = (
    root: HTMLElement,
    className: string,
    titleKey: string,
    fallbackTitle: string,
): void => {
    const win = globalThis as TGlobalWin;
    const title = typeof win.t === 'function' ? win.t(titleKey, fallbackTitle) : fallbackTitle;

    root.innerHTML = DOMPurify.sanitize(`<div class="${className}"><h1>${title}</h1></div>`);
};
