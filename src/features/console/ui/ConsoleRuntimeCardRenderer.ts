import type { IConsoleStatusItem } from '../services/ConsoleLogService';

export class ConsoleRuntimeCardRenderer {
    public createCards(items: IConsoleStatusItem[], activeViewId: string): HTMLElement[] {
        return items.map((item) => this._createCard(item, activeViewId));
    }

    public getViewId(item: IConsoleStatusItem): string {
        return item.id;
    }

    private _createCard(item: IConsoleStatusItem, activeViewId: string): HTMLButtonElement {
        const viewId = this.getViewId(item);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `console-runtime-card status-${item.status} kind-${item.kind}`;
        card.dataset['view'] = viewId;
        card.dataset['kind'] = item.kind;
        card.dataset['status'] = item.status;
        card.setAttribute('aria-pressed', String(viewId === activeViewId));

        const header = document.createElement('span');
        header.className = 'console-runtime-card-header';

        const title = document.createElement('span');
        title.className = 'console-runtime-card-title';
        title.textContent = item.label;

        const badge = document.createElement('span');
        badge.className = 'console-runtime-card-kind';
        badge.textContent = item.kind;

        const detail = document.createElement('span');
        detail.className = 'console-runtime-card-detail';
        detail.textContent = item.detail;

        header.append(title, badge);
        card.append(header, detail);

        if (viewId === activeViewId) {
            card.classList.add('active');
        }

        return card;
    }
}
