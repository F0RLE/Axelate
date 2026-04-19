import type { EngineInfoPopoverRuntime } from './ModuleSettingsEngineInfoPopover';

export type EngineCustomSelectControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncDisplay: () => void;
    destroy: () => void;
};

export function createEngineCustomSelectField(
    runtime: EngineInfoPopoverRuntime,
    options: { options?: string[] },
): EngineCustomSelectControl {
    const root = document.createElement('div');
    root.className = 'local-engine-select';
    const overlayHost: HTMLElement =
        document.getElementById('module-settings-modal') ?? document.body;
    const controller = new AbortController();
    const signal = controller.signal;

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = 'local-engine-select-value';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'local-engine-select-trigger';

    const valueEl = document.createElement('span');
    valueEl.className = 'local-engine-select-text';

    const chevron = document.createElement('span');
    chevron.className = 'local-engine-select-chevron';
    chevron.innerHTML = '&#9662;';

    const menu = document.createElement('div');
    menu.className = 'local-engine-select-menu';
    overlayHost.appendChild(menu);

    const updateMenuPosition = () => {
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = runtime.getViewportSize().height;
        const estimatedHeight = Math.min(Math.max((options.options?.length ?? 0) * 46 + 12, 120), 320);
        const spaceBelow = viewportHeight - rect.bottom - 12;
        const spaceAbove = rect.top - 12;
        const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

        menu.style.left = `${rect.left}px`;
        menu.style.width = `${rect.width}px`;
        menu.style.maxHeight = `${Math.max(140, Math.min(openUpward ? spaceAbove : spaceBelow, 320))}px`;
        menu.dataset['placement'] = openUpward ? 'top' : 'bottom';

        if (openUpward) {
            menu.style.top = `${Math.max(8, rect.top - Math.min(estimatedHeight, spaceAbove) - 6)}px`;
        } else {
            menu.style.top = `${rect.bottom + 6}px`;
        }
    };

    const closeMenu = () => {
        root.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        menu.classList.remove('open');
    };

    const syncDisplay = () => {
        valueEl.textContent = hiddenInput.value === '' ? (options.options?.[0] ?? '') : hiddenInput.value;
        menu.querySelectorAll('.local-engine-select-option').forEach((node) => {
            if (node instanceof HTMLButtonElement) {
                node.classList.toggle('selected', node.textContent === valueEl.textContent);
            }
        });
    };

    options.options?.forEach((option) => {
        const optionBtn = document.createElement('button');
        optionBtn.type = 'button';
        optionBtn.className = 'local-engine-select-option';
        optionBtn.textContent = option;
        optionBtn.addEventListener(
            'click',
            () => {
                hiddenInput.value = option;
                syncDisplay();
                closeMenu();
                hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
            },
            { signal },
        );
        menu.appendChild(optionBtn);
    });

    trigger.append(valueEl, chevron);
    trigger.setAttribute('aria-expanded', 'false');

    trigger.addEventListener(
        'click',
        () => {
            const willOpen = !root.classList.contains('open');
            document.querySelectorAll('.local-engine-select.open').forEach((element) => {
                element.classList.remove('open');
                const button = element.querySelector('.local-engine-select-trigger');
                if (button instanceof HTMLElement) {
                    button.setAttribute('aria-expanded', 'false');
                }
            });
            document.querySelectorAll('.local-engine-select-menu.open').forEach((element) => {
                element.classList.remove('open');
            });

            if (willOpen) {
                updateMenuPosition();
                root.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                menu.classList.add('open');
                return;
            }

            closeMenu();
        },
        { signal },
    );

    document.addEventListener(
        'click',
        (event) => {
            if (!root.contains(event.target as Node) && !menu.contains(event.target as Node)) {
                closeMenu();
            }
        },
        { signal },
    );

    runtime.addWindowListener(
        'resize',
        () => {
            if (root.classList.contains('open')) {
                updateMenuPosition();
            }
        },
        { signal },
    );

    runtime.addWindowListener(
        'scroll',
        () => {
            if (root.classList.contains('open')) {
                updateMenuPosition();
            }
        },
        { capture: true, signal },
    );

    root.append(hiddenInput, trigger);

    return {
        input: hiddenInput,
        root,
        syncDisplay,
        destroy: () => {
            controller.abort();
            closeMenu();
            menu.remove();
        },
    };
}
