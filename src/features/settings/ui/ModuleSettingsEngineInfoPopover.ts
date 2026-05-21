import {
    getEngineExtraArgDocs,
    getEngineRecommendedExtraArgs,
    type EngineRecommendedExtraArgsContext,
} from './ModuleSettingsEngineFieldSupport';

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
    getCurrentExtraArgs: (appId: string) => string[];
    getRecommendationContext: (appId: string) => EngineRecommendedExtraArgsContext;
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

    const recommendedBtn = document.createElement('button');
    recommendedBtn.type = 'button';
    recommendedBtn.className = 'local-engine-args-recommended';
    recommendedBtn.dataset['action'] = 'add-recommended';
    recommendedBtn.textContent = deps.translate(
        'ui.settings.engine.extra_args.recommended',
        'Recommended',
    );
    actions.appendChild(recommendedBtn);

    const addAllBtn = document.createElement('button');
    addAllBtn.type = 'button';
    addAllBtn.className = 'local-engine-args-copy-all';
    addAllBtn.dataset['action'] = 'add-all';
    addAllBtn.textContent = deps.translate('ui.settings.engine.extra_args.add_all', 'Add all');
    actions.appendChild(addAllBtn);

    const list = document.createElement('div');
    list.className = 'local-engine-args-list';

    docs.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'local-engine-args-item';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.dataset['flag'] = item.flag;
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

        row.appendChild(meta);
        list.appendChild(row);
    });

    popover.append(title, subtitle, actions, list);
    const appendFlags = (flags: string[]) => {
        const added = deps.appendExtraArgs(appId, flags);
        if (flags.length > 1) {
            deps.showToast(
                added > 0
                    ? deps.translate(
                          'ui.settings.engine.extra_args.add_all_success',
                          'Arguments added',
                      )
                    : deps.translate(
                          'ui.settings.engine.extra_args.add_all_exists',
                          'Arguments already added',
                      ),
                added > 0 ? 'success' : 'info',
            );
            return;
        }

        const [flag] = flags;
        if (flag === undefined) {
            return;
        }

        deps.showToast(
            (added > 0
                ? deps.translate('ui.settings.engine.extra_args.flag_added', '{flag} added')
                : deps.translate(
                      'ui.settings.engine.extra_args.flag_exists',
                      '{flag} already added',
                  )
            ).replace('{flag}', flag),
            added > 0 ? 'success' : 'info',
        );
    };

    popover.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const addAllAction = target.closest<HTMLButtonElement>('[data-action="add-all"]');
        if (addAllAction instanceof HTMLButtonElement) {
            appendFlags(docs.items.map((item) => item.flag));
            return;
        }

        const addRecommendedAction = target.closest<HTMLButtonElement>(
            '[data-action="add-recommended"]',
        );
        if (addRecommendedAction instanceof HTMLButtonElement) {
            const context = {
                ...deps.getRecommendationContext(appId),
                currentGroups: deps.getCurrentExtraArgs(appId),
            };
            appendFlags(getEngineRecommendedExtraArgs(appId, context));
            return;
        }

        const row = target.closest<HTMLElement>('.local-engine-args-item[data-flag]');
        const flag = row?.dataset['flag'];
        if (typeof flag === 'string' && flag !== '') {
            appendFlags([flag]);
        }
    });
    popover.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const row = target.closest<HTMLElement>('.local-engine-args-item[data-flag]');
        const flag = row?.dataset['flag'];
        if (typeof flag !== 'string' || flag === '') {
            return;
        }

        event.preventDefault();
        appendFlags([flag]);
    });
    const modal = document.getElementById('module-settings-modal');
    const popoverHost = modal ?? document.body;
    popoverHost.appendChild(popover);

    const updatePosition = () => {
        const modalRect = (modal ?? document.body).getBoundingClientRect();
        const availableWidth = modalRect.width;
        const edgeGap = Math.max(16, Math.min(32, Math.round(availableWidth * 0.015)));
        const gap = Math.max(14, Math.min(20, Math.round(availableWidth * 0.008)));
        const panelWidth = Math.max(300, Math.min(344, Math.round(availableWidth * 0.18)));

        modal?.style.setProperty('--app-modal-edge-gap', `${edgeGap}px`);
        modal?.style.setProperty('--app-modal-popover-width', `${panelWidth}px`);
        modal?.style.setProperty('--app-modal-popover-spacing', `${gap}px`);
    };
    updatePosition();
    modal?.classList.add('popover-open');

    popover.style.opacity = '0';
    popover.style.transition = 'opacity 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
    runtime.requestAnimationFrame(() => {
        runtime.requestAnimationFrame(() => {
            if (popover.isConnected) {
                popover.style.opacity = '1';
            }
        });
    });

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
        globalThis.clearTimeout(settlePositionTimer);

        popover.classList.add('closing');
        modal?.classList.remove('popover-open');
        modal?.classList.add('popover-closing');

        globalThis.setTimeout(() => {
            modal?.classList.remove('popover-closing');
            modal?.style.removeProperty('--app-modal-edge-gap');
            modal?.style.removeProperty('--app-modal-popover-width');
            modal?.style.removeProperty('--app-modal-popover-spacing');
            popover.remove();
            deps.onClose();
        }, 280);
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

        updatePosition();
    };

    const settlePositionTimer = globalThis.setTimeout(updatePosition, 320);

    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('keydown', handleEscape);
    runtime.addWindowListener('resize', handleReposition);
    runtime.addWindowListener('scroll', handleReposition, true);
    runtime.requestAnimationFrame(() => {
        runtime.requestAnimationFrame(updatePosition);
    });

    return {
        popover,
        close,
    };
}
