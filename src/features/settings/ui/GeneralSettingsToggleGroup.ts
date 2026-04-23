interface IToggleItem {
    id: string;
    label: string;
    icon: string;
}

interface IToggleGroupConfig {
    containerId: string;
    templateId: string;
    dataKey: 'pageId' | 'monitorId';
    hiddenItems: string[];
    items: IToggleItem[];
    getLabelKey: (item: IToggleItem) => string;
    onToggle: (id: string, enabled: boolean) => void;
}

type ToggleTranslate = (key: string, fallback: string) => string;
type ToggleLogger = { error: (message: string) => void };

export function initGeneralSettingsToggleGroup(
    config: IToggleGroupConfig,
    translate: ToggleTranslate,
    tracer: ToggleLogger,
): (() => void) | null {
    const container = document.getElementById(config.containerId);
    if (!(container instanceof HTMLElement)) {
        return null;
    }

    const template = document.getElementById(config.templateId) as HTMLTemplateElement | null;
    if (template === null) {
        tracer.error(`[GeneralSettingsRenderer] template #${config.templateId} not found`);
        return null;
    }

    const fragment = document.createDocumentFragment();
    config.items.forEach((item) => {
        fragment.appendChild(
            createGeneralSettingsToggleItem(
                template,
                item,
                config.hiddenItems,
                config.dataKey,
                translate,
                config.getLabelKey,
            ),
        );
    });

    container.innerHTML = '';
    container.appendChild(fragment);

    const handleClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest('.monitor-toggle-btn');
        if (!(button instanceof HTMLElement)) return;

        const itemId = button.dataset[config.dataKey];
        if (itemId === undefined || itemId === '') return;

        button.classList.toggle('active');
        config.onToggle(itemId, button.classList.contains('active'));
    };

    container.addEventListener('click', handleClick);
    return () => {
        container.removeEventListener('click', handleClick);
    };
}

function createGeneralSettingsToggleItem(
    template: HTMLTemplateElement,
    item: IToggleItem,
    hiddenItems: string[],
    dataKey: IToggleGroupConfig['dataKey'],
    translate: ToggleTranslate,
    getLabelKey: IToggleGroupConfig['getLabelKey'],
): DocumentFragment {
    const labelKey = getLabelKey(item);
    const clone = template.content.cloneNode(true) as DocumentFragment;

    const button = clone.querySelector('.monitor-toggle-btn');
    if (button instanceof HTMLElement) {
        if (hiddenItems.includes(item.id)) {
            button.classList.remove('active');
        }
        button.dataset[dataKey] = item.id;
    }

    const useElement = clone.querySelector('use');
    if (useElement !== null) {
        useElement.setAttribute('href', item.icon);
    }

    const labelElement = clone.querySelector('.toggle-label');
    if (labelElement instanceof HTMLElement) {
        labelElement.dataset['i18n'] = labelKey;
        labelElement.textContent = translate(labelKey, item.label);
    }

    return clone;
}
