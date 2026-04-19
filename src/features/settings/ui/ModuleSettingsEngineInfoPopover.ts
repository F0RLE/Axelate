import { getEngineExtraArgDocs } from './ModuleSettingsEngineExtraArgDocs';

export type EngineInfoPopoverRuntime = {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    getViewportSize: () => { width: number; height: number };
    addWindowListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ) => void;
    removeWindowListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ) => void;
};

type EngineInfoPopoverDeps = {
    anchor: HTMLButtonElement;
    appId: string;
    runtime: EngineInfoPopoverRuntime;
    translate: (key: string, fallback: string) => string;
    appendExtraArgs: (appId: string, groups: string[]) => number;
    showToast: (message: string, type: 'success' | 'info') => void;
    onClose: () => void;
};

export type EngineInfoPopoverHandle = {
    popover: HTMLDivElement;
    close: () => void;
};

export function createEngineInfoPopover(deps: EngineInfoPopoverDeps): EngineInfoPopoverHandle {
    const { anchor, appId, runtime } = deps;
    const docs = getEngineExtraArgDocs(appId);
    const popover = document.createElement('div');
    popover.className = 'local-engine-args-popover';
    popover.dataset['appId'] = appId;

    const title = document.createElement('div');
    title.className = 'local-engine-args-popover-title';
    title.textContent = docs.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'local-engine-args-popover-subtitle';
    subtitle.textContent = docs.subtitle;

    const actions = document.createElement('div');
    actions.className = 'local-engine-args-popover-actions';

    const addAllBtn = document.createElement('button');
    addAllBtn.type = 'button';
    addAllBtn.className = 'local-engine-args-copy-all';
    addAllBtn.textContent = deps.translate('ui.settings.engine.extra_args.add_all', 'Add all');
    addAllBtn.addEventListener('click', () => {
        const added = deps.appendExtraArgs(
            appId,
            docs.items.map((item) => item.flag),
        );
        deps.showToast(
            added > 0
                ? deps.translate('ui.settings.engine.extra_args.add_all_success', 'Arguments added')
                : deps.translate(
                      'ui.settings.engine.extra_args.add_all_exists',
                      'Arguments already added',
                  ),
            added > 0 ? 'success' : 'info',
        );
    });
    actions.appendChild(addAllBtn);

    const list = document.createElement('div');
    list.className = 'local-engine-args-list';

    docs.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'local-engine-args-item';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute(
            'aria-label',
            deps
                .translate('ui.settings.engine.extra_args.add_flag', 'Add {flag}')
                .replace('{flag}', item.flag),
        );

        const meta = document.createElement('div');
        meta.className = 'local-engine-args-item-meta';

        const flag = document.createElement('code');
        flag.className = 'local-engine-args-flag';
        flag.textContent = item.flag;

        const desc = document.createElement('p');
        desc.className = 'local-engine-args-desc';
        desc.textContent = item.description;

        meta.append(flag, desc);

        const addFlag = () => {
            const added = deps.appendExtraArgs(appId, [item.flag]);
            deps.showToast(
                (added > 0
                    ? deps.translate('ui.settings.engine.extra_args.flag_added', '{flag} added')
                    : deps.translate(
                          'ui.settings.engine.extra_args.flag_exists',
                          '{flag} already added',
                      )
                ).replace('{flag}', item.flag),
                added > 0 ? 'success' : 'info',
            );
        };

        row.addEventListener('click', addFlag);
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                addFlag();
            }
        });

        row.appendChild(meta);
        list.appendChild(row);
    });

    popover.append(title, subtitle, actions, list);
    const modal = document.getElementById('module-settings-modal');
    if (modal === null) {
        document.body.appendChild(popover);
    } else {
        modal.appendChild(popover);
        modal.classList.add('popover-open');
    }

    popover.style.opacity = '0';
    popover.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    runtime.requestAnimationFrame(() => {
        runtime.requestAnimationFrame(() => {
            if (popover.isConnected) {
                popover.style.opacity = '1';
            }
        });
    });

    const updatePosition = () => {
        const appModal = modal?.querySelector('.app-modal');
        const targetRect = (appModal ?? modal ?? document.body).getBoundingClientRect();
        const viewportWidth = runtime.getViewportSize().width;
        const panelWidth = 328;
        const margin = 16;

        let panelLeft = targetRect.right + 16;
        if (panelLeft + panelWidth > viewportWidth - margin) {
            panelLeft = Math.max(margin, viewportWidth - panelWidth - margin);
        }

        popover.style.width = `${panelWidth}px`;
        popover.style.left = `${panelLeft}px`;
        popover.style.top = `${targetRect.top}px`;
        popover.style.height = `${targetRect.height}px`;
    };

    let isClosed = false;
    const close = () => {
        if (isClosed) {
            return;
        }

        isClosed = true;
        document.removeEventListener('click', handleDocumentClick, true);
        document.removeEventListener('keydown', handleEscape);
        runtime.removeWindowListener('resize', handleReposition);
        runtime.removeWindowListener('scroll', handleReposition, true);

        if (modal !== null) {
            modal.classList.remove('popover-open');
        }

        popover.remove();
        deps.onClose();
    };

    const handleDocumentClick = (event: MouseEvent) => {
        const target = event.target as Node;
        if (!popover.contains(target) && !anchor.contains(target)) {
            close();
        }
    };

    const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            close();
        }
    };

    const handleReposition = () => {
        if (isClosed) {
            return;
        }

        if (modal !== null) {
            modal.classList.add('popover-open');
        }
        updatePosition();
    };

    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('keydown', handleEscape);
    runtime.addWindowListener('resize', handleReposition);
    runtime.addWindowListener('scroll', handleReposition, true);

    const startTime = performance.now();
    const syncAnimation = (time: number) => {
        if (isClosed) {
            return;
        }

        updatePosition();
        if (time - startTime < 400) {
            runtime.requestAnimationFrame(syncAnimation);
        }
    };
    runtime.requestAnimationFrame(syncAnimation);

    return {
        popover,
        close,
    };
}
