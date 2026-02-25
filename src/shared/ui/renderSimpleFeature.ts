import DOMPurify from 'dompurify';
import { getGlobalWin } from '@/shared/utils/globalAccessor';

export const renderSimpleFeature = (
    root: HTMLElement,
    className: string,
    titleKey: string,
    fallbackTitle: string,
): void => {
    const win = getGlobalWin();
    const title = typeof win.t === 'function' ? win.t(titleKey, fallbackTitle) : fallbackTitle;

    root.innerHTML = DOMPurify.sanitize(`<div class="${className}"><h1>${title}</h1></div>`);
};
