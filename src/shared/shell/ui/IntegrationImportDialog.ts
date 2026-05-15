type TranslateFunc = (key: string, fallback: string) => string;

type DialogElements = {
    overlay: HTMLDivElement;
    input: HTMLInputElement;
    confirm: HTMLButtonElement;
    cancel: HTMLButtonElement;
};

const CLOSE_INTEGRATION_IMPORT_DIALOG_EVENT = 'integration-import-dialog:close';

export function closeIntegrationImportDialogs(): void {
    globalThis.dispatchEvent(new Event(CLOSE_INTEGRATION_IMPORT_DIALOG_EVENT));
}

export async function openIntegrationUrlDialog(options: {
    translate: TranslateFunc;
}): Promise<string | null> {
    return await new Promise((resolve) => {
        const elements = createDialogElements(options.translate);
        let settled = false;

        const close = (value: string | null) => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeyDown);
            globalThis.removeEventListener(CLOSE_INTEGRATION_IMPORT_DIALOG_EVENT, onExternalClose);
            document.body.classList.remove('integration-import-open');
            elements.overlay.remove();
            resolve(value);
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            close(null);
        };

        const onExternalClose = () => {
            close(null);
        };

        elements.cancel.addEventListener('click', () => {
            close(null);
        });
        elements.overlay.addEventListener('click', (event) => {
            if (event.target === elements.overlay) {
                close(null);
            }
        });
        elements.confirm.addEventListener('click', () => {
            const value = elements.input.value.trim();
            if (value === '') {
                elements.input.focus();
                return;
            }
            close(value);
        });
        elements.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                elements.confirm.click();
            }
        });

        document.body.appendChild(elements.overlay);
        document.body.classList.add('integration-import-open');
        document.addEventListener('keydown', onKeyDown);
        globalThis.addEventListener(CLOSE_INTEGRATION_IMPORT_DIALOG_EVENT, onExternalClose);
        requestAnimationFrame(() => {
            elements.input.focus();
        });
    });
}

function createDialogElements(translate: TranslateFunc): DialogElements {
    const overlay = document.createElement('div');
    overlay.className = 'integration-import-dialog-view';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'integration-import-dialog-panel';

    const title = document.createElement('h3');
    title.dataset['i18n'] = 'ui.launcher.integrations.import.url_title';
    title.textContent = translate(
        'ui.launcher.integrations.import.url_title',
        'Add integration URL',
    );

    const description = document.createElement('p');
    description.dataset['i18n'] = 'ui.launcher.integrations.import.url_desc';
    description.textContent = translate(
        'ui.launcher.integrations.import.url_desc',
        'Paste a GitHub repository or direct archive URL.',
    );

    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'integration-import-url-input';
    input.dataset['i18nPlaceholder'] = 'ui.launcher.integrations.import.url_placeholder';
    input.placeholder = translate(
        'ui.launcher.integrations.import.url_placeholder',
        'Repository or archive URL',
    );
    input.value = '';
    input.autocomplete = 'new-password';
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-form-type', 'other');
    input.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'integration-import-dialog-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'integration-import-dialog-cancel';
    cancel.dataset['i18n'] = 'ui.launcher.button.cancel';
    cancel.textContent = translate('ui.launcher.button.cancel', 'Cancel');

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'integration-import-dialog-confirm';
    confirm.dataset['i18n'] = 'ui.launcher.integrations.import.add';
    confirm.textContent = translate('ui.launcher.integrations.import.add', 'Add');

    actions.append(cancel, confirm);
    panel.append(title, description, input, actions);
    overlay.appendChild(panel);

    return { overlay, input, confirm, cancel };
}
