type ConsoleFilterControlHelperDeps<Level extends string> = {
    activeLevels: Set<Level>;
    allLevels: readonly Level[];
    registerCleanup: (cleanup: () => void) => void;
    onClearLogs: () => void;
    onClearAllLogs: () => void;
    onCopyLogs: () => void;
    onOpenLogsFolder: () => void;
    onFiltersChanged: () => void;
};

export class ConsoleFilterControlHelper<Level extends string> {
    private _clearConfirmationTimeout: ReturnType<typeof setTimeout> | null = null;

    public constructor(private readonly _deps: ConsoleFilterControlHelperDeps<Level>) {}

    public bindControls(): void {
        const controls = document.querySelector('.console-controls-panel');
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
                this._handleClearButton(clearButton);
                return;
            }

            this._resetClearConfirmation();

            const copyButton = target.closest('#copy-logs-btn');
            if (copyButton instanceof HTMLButtonElement) {
                this._deps.onCopyLogs();
                return;
            }

            const openLogsFolderButton = target.closest('#open-logs-folder-btn');
            if (openLogsFolderButton instanceof HTMLButtonElement) {
                this._deps.onOpenLogsFolder();
                return;
            }

            const filterButton = target.closest('.console-filter-chip');
            if (
                filterButton instanceof HTMLButtonElement &&
                this._updateLevelSelection(filterButton, event)
            ) {
                this.syncButtons();
                this._deps.onFiltersChanged();
            }
        };
        const handleContextMenu = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const clearButton = target.closest('#clear-logs-btn');
            if (!(clearButton instanceof HTMLButtonElement)) {
                return;
            }

            event.preventDefault();
            this._handleClearAllButton(clearButton);
        };

        controls.addEventListener('click', handleClick);
        controls.addEventListener('contextmenu', handleContextMenu);
        this.syncButtons();
        this._deps.registerCleanup(() => {
            controls.removeEventListener('click', handleClick);
            controls.removeEventListener('contextmenu', handleContextMenu);
            this._resetClearConfirmation();
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

    private _updateLevelSelection(button: HTMLButtonElement, event: Event): boolean {
        const level = button.dataset['level'] as Level | undefined;
        if (level === undefined) {
            return false;
        }

        if (this._hasMultiSelectModifier(event)) {
            return this._toggleLevel(level);
        }

        return this._isolateLevelOrReset(level);
    }

    private _toggleLevel(level: Level): boolean {
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

    private _isolateLevelOrReset(level: Level): boolean {
        const isAlreadyIsolated =
            this._deps.activeLevels.size === 1 && this._deps.activeLevels.has(level);
        if (isAlreadyIsolated) {
            return this._restoreAllLevels();
        }

        this._deps.activeLevels.clear();
        this._deps.activeLevels.add(level);
        return true;
    }

    private _restoreAllLevels(): boolean {
        if (this._deps.activeLevels.size === this._deps.allLevels.length) {
            return false;
        }

        this._deps.activeLevels.clear();
        this._deps.allLevels.forEach((level) => {
            this._deps.activeLevels.add(level);
        });
        return true;
    }

    private _hasMultiSelectModifier(event: Event): boolean {
        return event instanceof MouseEvent && (event.ctrlKey === true || event.metaKey === true);
    }

    private _handleClearButton(button: HTMLButtonElement): void {
        if (button.dataset['confirming'] === 'true') {
            this._resetClearConfirmation();
            this._deps.onClearLogs();
            return;
        }

        button.dataset['confirming'] = 'true';
        button.classList.add('confirming');
        button.setAttribute('aria-label', 'Confirm clear console logs');
        button.title = 'Click again to clear logs';
        this._clearConfirmationTimeout = setTimeout(() => {
            this._resetClearConfirmation();
        }, 2200);
    }

    private _handleClearAllButton(button: HTMLButtonElement): void {
        if (button.dataset['confirmingAll'] === 'true') {
            this._resetClearConfirmation();
            this._deps.onClearAllLogs();
            return;
        }

        this._resetClearConfirmation();
        button.dataset['confirmingAll'] = 'true';
        button.classList.add('confirming');
        button.setAttribute('aria-label', 'Confirm clear all console logs');
        button.title = 'Right-click again to clear all logs';
        this._clearConfirmationTimeout = setTimeout(() => {
            this._resetClearConfirmation();
        }, 2200);
    }

    private _resetClearConfirmation(): void {
        if (this._clearConfirmationTimeout !== null) {
            clearTimeout(this._clearConfirmationTimeout);
            this._clearConfirmationTimeout = null;
        }

        const button = document.getElementById('clear-logs-btn');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        delete button.dataset['confirming'];
        delete button.dataset['confirmingAll'];
        button.classList.remove('confirming');
        button.setAttribute('aria-label', 'Clear Console');
        button.title = 'Clear Console';
    }
}
