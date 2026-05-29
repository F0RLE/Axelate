import type { IConsoleLogView } from '../services/ConsoleLogService';

export class ConsoleViewHelper {
    public syncLogPanes(activeViewId: string): void {
        document.querySelectorAll<HTMLElement>('.logs-pane').forEach((pane) => {
            const isActive = pane.id === `logs-${activeViewId}`;
            pane.classList.toggle('active', isActive);
            pane.hidden = !isActive;
        });
    }

    public shouldRebuildViews(toolbar: HTMLElement, views: IConsoleLogView[]): boolean {
        const currentButtons = Array.from(toolbar.querySelectorAll<HTMLElement>('.console-tab'));
        if (currentButtons.length !== views.length) {
            return true;
        }

        return currentButtons.some((button, index) => {
            const view = views[index];
            return button.dataset['view'] !== view?.id || button.textContent !== view?.label;
        });
    }

    public replaceChildren(container: HTMLElement, children: HTMLElement[]): void {
        container.replaceChildren(...children);
    }

    public createViewButton(view: IConsoleLogView, activeViewId: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'console-tab';
        button.type = 'button';
        button.dataset['view'] = view.id;
        button.textContent = view.label;
        if (view.id === 'agent') {
            button.classList.add('console-tab--agent');
        }
        if (view.id === activeViewId) {
            button.classList.add('active');
        }
        return button;
    }

    public createLogPane(view: IConsoleLogView, activeViewId: string): HTMLDivElement {
        const pane = document.createElement('div');
        pane.id = `logs-${view.id}`;
        pane.className = 'logs-pane';
        if (view.id === 'agent') {
            pane.classList.add('logs-pane--agent');
        }
        if (view.id === activeViewId) {
            pane.classList.add('active');
        }
        return pane;
    }
}
