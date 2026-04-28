import type { EngineInfoPopoverRuntime } from './ModuleSettingsEngineInfoPopover';

export type EngineCustomSelectControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncDisplay: () => void;
    destroy: () => void;
};

type ActiveEngineSelect = {
    root: HTMLDivElement;
    trigger: HTMLButtonElement;
    menu: HTMLDivElement;
    updateMenuPosition: () => void;
    closeMenu: () => void;
};

type SharedEngineSelectListeners = {
    controller: AbortController;
    refs: number;
};

let _activeEngineSelect: ActiveEngineSelect | null = null;
let _sharedEngineSelectListeners: SharedEngineSelectListeners | null = null;

function _closeActiveEngineSelect(exceptRoot?: HTMLDivElement): void {
    if (
        _activeEngineSelect === null ||
        (exceptRoot instanceof HTMLDivElement && _activeEngineSelect.root === exceptRoot)
    ) {
        return;
    }

    _activeEngineSelect.closeMenu();
    _activeEngineSelect = null;
}

function _ensureSharedEngineSelectListeners(runtime: EngineInfoPopoverRuntime): AbortSignal {
    if (_sharedEngineSelectListeners !== null) {
        _sharedEngineSelectListeners.refs += 1;
        return _sharedEngineSelectListeners.controller.signal;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    document.addEventListener(
        'click',
        (event) => {
            if (_activeEngineSelect === null) {
                return;
            }

            const target = event.target;
            if (
                target instanceof Node &&
                (_activeEngineSelect.root.contains(target) ||
                    _activeEngineSelect.menu.contains(target))
            ) {
                return;
            }

            _closeActiveEngineSelect();
        },
        { signal },
    );

    const repositionActiveMenu = () => {
        _activeEngineSelect?.updateMenuPosition();
    };

    runtime.addWindowListener('resize', repositionActiveMenu, { signal });
    runtime.addWindowListener('scroll', repositionActiveMenu, { capture: true, signal });

    _sharedEngineSelectListeners = {
        controller,
        refs: 1,
    };

    return signal;
}

function _releaseSharedEngineSelectListeners(): void {
    if (_sharedEngineSelectListeners === null) {
        return;
    }

    _sharedEngineSelectListeners.refs -= 1;
    if (_sharedEngineSelectListeners.refs > 0) {
        return;
    }

    _sharedEngineSelectListeners.controller.abort();
    _sharedEngineSelectListeners = null;
    _activeEngineSelect = null;
}

export function createEngineCustomSelectField(
    runtime: EngineInfoPopoverRuntime,
    options: { options?: string[]; optionLabels?: Record<string, string> },
): EngineCustomSelectControl {
    const root = document.createElement('div');
    root.className = 'local-engine-select';
    const overlayHost: HTMLElement =
        document.getElementById('module-settings-modal') ?? document.body;
    const controller = new AbortController();
    const signal = controller.signal;
    _ensureSharedEngineSelectListeners(runtime);

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
        const estimatedHeight = Math.min(
            Math.max((options.options?.length ?? 0) * 46 + 12, 120),
            320,
        );
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
        if (_activeEngineSelect?.root === root) {
            _activeEngineSelect = null;
        }
    };

    const syncDisplay = () => {
        const currentValue =
            hiddenInput.value === '' ? (options.options?.[0] ?? '') : hiddenInput.value;
        valueEl.textContent = options.optionLabels?.[currentValue] ?? currentValue;
        menu.querySelectorAll('.local-engine-select-option').forEach((node) => {
            if (node instanceof HTMLButtonElement) {
                node.classList.toggle('selected', node.dataset['value'] === currentValue);
            }
        });
    };

    options.options?.forEach((option) => {
        const optionBtn = document.createElement('button');
        optionBtn.type = 'button';
        optionBtn.className = 'local-engine-select-option';
        optionBtn.dataset['value'] = option;
        optionBtn.textContent = options.optionLabels?.[option] ?? option;
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
            _closeActiveEngineSelect(root);

            if (willOpen) {
                updateMenuPosition();
                root.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                menu.classList.add('open');
                _activeEngineSelect = {
                    root,
                    trigger,
                    menu,
                    updateMenuPosition,
                    closeMenu,
                };
                return;
            }

            closeMenu();
        },
        { signal },
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
            _releaseSharedEngineSelectListeners();
        },
    };
}
