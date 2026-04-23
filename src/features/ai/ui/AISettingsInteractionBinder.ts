import type { ThinkingLevel } from '@/shared/services/state/UiStateStore';

type AISettingsInteractionBinderDeps = {
    appId: string;
    container: HTMLElement;
    signal: AbortSignal;
    normalizeKeyInput: (event: Event) => void;
    maybeClearStoredMask: (event: Event) => void;
    openKeyProviderUrl: () => void;
    toggleKeyVisibility: () => Promise<void>;
    checkKey: () => Promise<void>;
    selectModel: (modelKey: string) => void;
    submitCustomModel: () => Promise<void>;
    removeCustomModel: (modelKey: string) => Promise<void>;
    setThinkingLevel: (level: ThinkingLevel) => void;
    getSelectedModel: () => string;
    setInternetAccessEnabled: (enabled: boolean) => void;
};

export function bindAISettingsInteractions(deps: AISettingsInteractionBinderDeps): void {
    const { appId, container, signal } = deps;
    const input = container.querySelector(`#${appId}-api-key-input`);

    const addListener = (element: Element | null, type: string, fn: EventListener): void => {
        if (element !== null) {
            element.addEventListener(type, fn, { signal });
        }
    };

    addListener(input, 'input', (event) => {
        deps.normalizeKeyInput(event);
    });

    addListener(input, 'beforeinput', (event) => {
        deps.maybeClearStoredMask(event);
    });

    addListener(input, 'keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
            event.preventDefault();
        }
    });

    addListener(container.querySelector(`#${appId}-key-toggle-btn`), 'click', () => {
        void deps.toggleKeyVisibility();
    });

    addListener(container.querySelector(`#${appId}-api-link`), 'click', (event) => {
        event.preventDefault();
        deps.openKeyProviderUrl();
    });

    addListener(container.querySelector(`#${appId}-key-check-btn`), 'click', () => {
        void deps.checkKey();
    });

    const submitCustomModel = (event?: Event): void => {
        event?.preventDefault();
        void deps.submitCustomModel();
    };

    addListener(container.querySelector(`#${appId}-custom-model-save-btn`), 'click', (event) => {
        submitCustomModel(event);
    });

    const customModelInputs = [
        container.querySelector(`#${appId}-custom-model-id-input`),
        container.querySelector(`#${appId}-custom-model-name-input`),
    ];

    customModelInputs.forEach((input) => {
        addListener(input, 'keydown', (event) => {
            const keyEvent = event as KeyboardEvent;
            if (keyEvent.key !== 'Enter') {
                return;
            }

            submitCustomModel(event);
        });
    });

    const handleCustomModelRemoval = (event: Event) => {
        const removeButton = (event.target as Element).closest<HTMLElement>(
            '.ai-model-card-remove[data-model-remove]',
        );
        if (!removeButton) {
            return;
        }

        const keyEvent = event as KeyboardEvent;
        if (event.type === 'keydown' && keyEvent.key !== 'Enter' && keyEvent.key !== ' ') {
            return;
        }

        const modelKey = removeButton.dataset['modelRemove'];
        if (modelKey === undefined || modelKey === '') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void deps.removeCustomModel(modelKey);
    };

    container.addEventListener('click', handleCustomModelRemoval, { signal });
    container.addEventListener('keydown', handleCustomModelRemoval, { signal });

    const handleModelSelection = (event: Event) => {
        if ((event.target as Element).closest('.ai-model-card-remove') !== null) {
            return;
        }

        const card = (event.target as Element).closest<HTMLElement>(
            '.ai-model-card[data-model-key]',
        );
        if (!card) return;

        const keyEvent = event as KeyboardEvent;
        if (event.type === 'keydown' && keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;

        const modelKey = card.dataset['modelKey'];
        if (modelKey !== undefined && modelKey !== '') {
            event.preventDefault();
            deps.selectModel(modelKey);
        }
    };

    container.addEventListener('click', handleModelSelection, { signal });
    container.addEventListener('keydown', handleModelSelection, { signal });

    const thinkingGrid = container.querySelector(`#${appId}-thinking-grid`);
    if (thinkingGrid !== null) {
        const buttons = Array.from(
            thinkingGrid.querySelectorAll<HTMLElement>('.thinking-option-card'),
        );

        const updateThinking = (target: HTMLElement) => {
            const val = (target.dataset['value'] ?? 'high') as ThinkingLevel;
            deps.setThinkingLevel(val);

            buttons.forEach((button) => {
                button.classList.remove('selected');
                button.setAttribute('aria-checked', 'false');
            });
            target.classList.add('selected');
            target.setAttribute('aria-checked', 'true');

            const savedModel = deps.getSelectedModel();
            if (savedModel !== '') {
                deps.selectModel(savedModel);
            }
        };

        buttons.forEach((btn) => {
            btn.addEventListener(
                'click',
                (event) => {
                    updateThinking(event.currentTarget as HTMLElement);
                },
                { signal },
            );
            btn.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        updateThinking(event.currentTarget as HTMLElement);
                    }
                },
                { signal },
            );
        });
    }

    const internetGrid = container.querySelector(`#${appId}-internet-grid`);
    if (internetGrid !== null) {
        const buttons = Array.from(
            internetGrid.querySelectorAll<HTMLElement>('.internet-access-card'),
        );

        const updateInternetAccess = (target: HTMLElement) => {
            const enabled = (target.dataset['value'] ?? 'on') === 'on';
            deps.setInternetAccessEnabled(enabled);

            buttons.forEach((button) => {
                const buttonEnabled = (button.dataset['value'] ?? 'off') === 'on';
                button.classList.toggle('selected', buttonEnabled === enabled);
                button.setAttribute('aria-checked', String(buttonEnabled === enabled));
            });
        };

        buttons.forEach((btn) => {
            btn.addEventListener(
                'click',
                (event) => {
                    updateInternetAccess(event.currentTarget as HTMLElement);
                },
                { signal },
            );
            btn.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        updateInternetAccess(event.currentTarget as HTMLElement);
                    }
                },
                { signal },
            );
        });
    }
}
