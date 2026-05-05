import { afterEach, describe, expect, it } from 'vitest';
import { I18nUI } from '@/infrastructure/i18n/I18nUI';
import type { I18nService } from '@/infrastructure/i18n/I18nService';
import { closeIntegrationImportDialogs, openIntegrationUrlDialog } from './IntegrationImportDialog';

describe('IntegrationImportDialog', () => {
    afterEach(() => {
        closeIntegrationImportDialogs();
        document.body.innerHTML = '';
    });

    it('closes when transient dialogs are dismissed globally', async () => {
        const result = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });

        expect(document.querySelector('.integration-import-dialog-view')).not.toBeNull();

        closeIntegrationImportDialogs();

        await expect(result).resolves.toBeNull();
        expect(document.querySelector('.integration-import-dialog-view')).toBeNull();
        expect(document.body.classList.contains('integration-import-open')).toBe(false);
    });

    it('returns the trimmed URL on confirm', async () => {
        const result = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        const input = document.querySelector<HTMLInputElement>('.integration-import-url-input');
        const confirm = document.querySelector<HTMLButtonElement>(
            '.integration-import-dialog-confirm',
        );

        if (input === null || confirm === null) {
            throw new Error('dialog controls missing');
        }

        input.value = '  https://github.com/F0RLE/Axelate-telegram-parser  ';
        confirm.click();

        await expect(result).resolves.toBe('https://github.com/F0RLE/Axelate-telegram-parser');
        expect(document.querySelector('.integration-import-dialog-view')).toBeNull();
    });

    it('keeps the dialog open when confirm is clicked with an empty URL', async () => {
        const result = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        const input = document.querySelector<HTMLInputElement>('.integration-import-url-input');
        const confirm = document.querySelector<HTMLButtonElement>(
            '.integration-import-dialog-confirm',
        );

        if (input === null || confirm === null) {
            throw new Error('dialog controls missing');
        }

        confirm.click();

        expect(document.querySelector('.integration-import-dialog-view')).not.toBeNull();
        expect(document.activeElement).toBe(input);

        closeIntegrationImportDialogs();
        await result;
    });

    it('submits with Enter and cancels with Escape', async () => {
        const submitted = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        const input = document.querySelector<HTMLInputElement>('.integration-import-url-input');
        if (input === null) {
            throw new Error('dialog input missing');
        }

        input.value = 'https://example.com/integration.zip';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await expect(submitted).resolves.toBe('https://example.com/integration.zip');

        const cancelled = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        await expect(cancelled).resolves.toBeNull();
    });

    it('cancels from the cancel button and backdrop', async () => {
        const fromButton = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        document.querySelector<HTMLButtonElement>('.integration-import-dialog-cancel')?.click();

        await expect(fromButton).resolves.toBeNull();

        const fromBackdrop = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        const overlay = document.querySelector<HTMLElement>('.integration-import-dialog-view');
        if (overlay === null) {
            throw new Error('dialog overlay missing');
        }
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await expect(fromBackdrop).resolves.toBeNull();
    });

    it('updates visible copy when global translations are reapplied', async () => {
        const result = openIntegrationUrlDialog({
            translate: (_key, fallback) => fallback,
        });
        const i18nUI = new I18nUI({
            t: (key: string) => `translated:${key}`,
            getCurrentLang: () => 'ru',
        } as I18nService);

        i18nUI.applyTranslations();

        expect(document.querySelector('h3')?.textContent).toBe(
            'translated:ui.launcher.integrations.import.url_title',
        );
        expect(document.querySelector('p')?.textContent).toBe(
            'translated:ui.launcher.integrations.import.url_desc',
        );
        expect(document.querySelector<HTMLInputElement>('input')?.placeholder).toBe(
            'translated:ui.launcher.integrations.import.url_placeholder',
        );
        expect(document.querySelector('.integration-import-dialog-cancel')?.textContent).toBe(
            'translated:ui.launcher.button.cancel',
        );
        expect(document.querySelector('.integration-import-dialog-confirm')?.textContent).toBe(
            'translated:ui.launcher.integrations.import.add',
        );

        i18nUI.destroy();
        closeIntegrationImportDialogs();
        await result;
    });
});
