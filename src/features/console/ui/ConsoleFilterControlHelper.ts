type ConsoleFilterControlHelperDeps<Level extends string> = {
    activeLevels: Set<Level>;
    registerCleanup: (cleanup: () => void) => void;
    onClearLogs: () => void;
    onCopyLogs: () => void;
    onFiltersChanged: () => void;
};

export class ConsoleFilterControlHelper<Level extends string> {
    public constructor(private readonly _deps: ConsoleFilterControlHelperDeps<Level>) {}

    public bindControls(): void {
        const controls = document.querySelector('.console-toolbar-right');
        if (!(controls instanceof HTMLElement)) {
            return;
        }

        const handleClick = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const clearButton = target.closest('#clear-logs-btn');
            if (clearButton instanceof HTMLButtonElement) {
                this._deps.onClearLogs();
                return;
            }

            const copyButton = target.closest('#copy-logs-btn');
            if (copyButton instanceof HTMLButtonElement) {
                this._deps.onCopyLogs();
                return;
            }

            const filterButton = target.closest('.console-filter-chip');
            if (filterButton instanceof HTMLButtonElement && this._toggleLevel(filterButton)) {
                this.syncButtons();
                this._deps.onFiltersChanged();
            }
        };

        controls.addEventListener('click', handleClick);
        this.syncButtons();
        this._deps.registerCleanup(() => {
            controls.removeEventListener('click', handleClick);
        });
    }

    public syncButtons(): void {
        document.querySelectorAll<HTMLButtonElement>('.console-filter-chip').forEach((button) => {
            const level = button.dataset['level'] as Level | undefined;
            const isActive = level !== undefined && this._deps.activeLevels.has(level);
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    private _toggleLevel(button: HTMLButtonElement): boolean {
        const level = button.dataset['level'] as Level | undefined;
        if (level === undefined) {
            return false;
        }

        if (this._deps.activeLevels.has(level)) {
            if (this._deps.activeLevels.size === 1) {
                return false;
            }

            this._deps.activeLevels.delete(level);
            return true;
        }

        this._deps.activeLevels.add(level);
        return true;
    }
}
