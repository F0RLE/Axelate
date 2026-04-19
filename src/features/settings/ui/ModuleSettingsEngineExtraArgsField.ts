type ExtraArgsTranslate = (key: string, fallback: string) => string;

export type EngineExtraArgsControl = {
    input: HTMLInputElement;
    root: HTMLDivElement;
    syncTokens: () => void;
    getGroups: () => string[];
    setGroups: (groups: string[]) => void;
};

export function createEngineExtraArgsField(
    translate: ExtraArgsTranslate,
): EngineExtraArgsControl {
    const root = document.createElement('div');
    root.className = 'local-engine-tags-editor';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = 'local-engine-tags-value';

    const chips = document.createElement('div');
    chips.className = 'local-engine-tags-chips';

    const parseGroups = (raw: string): string[] => {
        const tokens = raw
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token !== '');
        const groups: string[] = [];

        for (let index = 0; index < tokens.length; index += 1) {
            const current = tokens[index];
            const next = tokens[index + 1];

            if (
                current !== undefined &&
                current.startsWith('-') &&
                next !== undefined &&
                !next.startsWith('-')
            ) {
                groups.push(`${current} ${next}`);
                index += 1;
                continue;
            }

            if (current !== undefined) {
                groups.push(current);
            }
        }

        return groups;
    };

    const flattenGroups = (groups: string[]): string =>
        groups
            .flatMap((group) =>
                group
                    .split(/\s+/)
                    .map((token) => token.trim())
                    .filter((token) => token !== ''),
            )
            .join(' ');

    const getGroups = (): string[] => parseGroups(hiddenInput.value);

    const syncTokens = () => {
        chips.innerHTML = '';
        getGroups().forEach((group, index) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'local-engine-tag-chip';
            chip.title = translate('ui.settings.engine.extra_args.remove', 'Remove');

            const label = document.createElement('span');
            label.className = 'local-engine-tag-chip-label';
            label.textContent = group;

            const remove = document.createElement('span');
            remove.className = 'local-engine-tag-chip-remove';
            remove.textContent = 'x';

            chip.append(label, remove);
            chip.addEventListener('click', () => {
                const updated = getGroups().filter((_, groupIndex) => groupIndex !== index);
                setGroups(updated);
            });
            chips.appendChild(chip);
        });
    };

    const setGroups = (groups: string[]) => {
        hiddenInput.value = flattenGroups(groups);
        syncTokens();
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    root.append(chips, hiddenInput);

    return { input: hiddenInput, root, syncTokens, getGroups, setGroups };
}
