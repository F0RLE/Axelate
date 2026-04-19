type ConsoleFilterLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

type ConsoleRenderDecision = {
    isInitialRender: boolean;
    shouldStickToBottom: boolean;
    distanceFromBottom: number;
};

export class ConsoleViewStateController {
    private _hasRenderedLogs = false;
    private _activeViewId = 'general';
    private readonly _activeLevels = new Set<ConsoleFilterLevel>([
        'ERROR',
        'WARN',
        'INFO',
        'DEBUG',
    ]);
    private readonly _renderedEntriesByView = new Map<string, HTMLElement[]>();

    public get activeViewId(): string {
        return this._activeViewId;
    }

    public set activeViewId(value: string) {
        this._activeViewId = value;
    }

    public get activeLevels(): Set<ConsoleFilterLevel> {
        return this._activeLevels;
    }

    public reset(): void {
        this._hasRenderedLogs = false;
        this._activeViewId = 'general';
        this._renderedEntriesByView.clear();
        this._activeLevels.clear();
        this._activeLevels.add('ERROR');
        this._activeLevels.add('WARN');
        this._activeLevels.add('INFO');
        this._activeLevels.add('DEBUG');
    }

    public ensureKnownActiveView(knownViewIds: Set<string>): void {
        if (!knownViewIds.has(this._activeViewId)) {
            this._activeViewId = 'general';
        }
    }

    public setRenderedEntries(viewId: string, entries: HTMLElement[]): void {
        this._renderedEntriesByView.set(viewId, entries);
    }

    public clearRenderedEntries(viewId: string): void {
        this._renderedEntriesByView.delete(viewId);
    }

    public getRenderedEntries(viewId: string): HTMLElement[] {
        return this._renderedEntriesByView.get(viewId) ?? [];
    }

    public captureRenderDecision(
        scrollContainer: HTMLElement,
        clear: boolean,
    ): ConsoleRenderDecision {
        const isInitialRender = this._hasRenderedLogs === false;
        const wasNearBottom =
            scrollContainer.scrollHeight -
                scrollContainer.scrollTop -
                scrollContainer.clientHeight <
            40;
        const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

        return {
            isInitialRender,
            shouldStickToBottom: isInitialRender || clear || wasNearBottom,
            distanceFromBottom,
        };
    }

    public finalizeRender(): void {
        this._hasRenderedLogs = true;
    }
}
