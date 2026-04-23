export class CardResizer {
    private isResizing = false;
    private card: HTMLElement | null = null;
    private startX = 0;
    private startWidth = 'full';
    private hasSwitched = false;
    private _initialized = false;
    private static readonly HANDLE_SELECTOR = '.card-resize-handle, .resize-handle';
    private readonly _boundMouseDown = (e: MouseEvent) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const handle = target.closest(CardResizer.HANDLE_SELECTOR);
        if (!(handle instanceof HTMLElement)) return;

        this.start(e, handle);
    };
    private readonly _boundMouseMove = (e: MouseEvent) => {
        this.move(e);
    };
    private readonly _boundMouseUp = () => {
        this.stop();
    };

    constructor(private readonly onSave: (id: string, width: string) => void) {}

    init() {
        if (this._initialized) return;
        this._initialized = true;

        document.addEventListener('mousedown', this._boundMouseDown);
        document.addEventListener('mousemove', this._boundMouseMove);
        document.addEventListener('mouseup', this._boundMouseUp);
    }

    destroy() {
        if (!this._initialized) return;
        this.stop();
        document.removeEventListener('mousedown', this._boundMouseDown);
        document.removeEventListener('mousemove', this._boundMouseMove);
        document.removeEventListener('mouseup', this._boundMouseUp);
        this._initialized = false;
    }

    private start(e: MouseEvent, handle: HTMLElement) {
        e.preventDefault();
        this.isResizing = true;
        const resizableCard = handle.closest('.resizable-card');
        if (resizableCard instanceof HTMLElement) {
            this.card = resizableCard;
        }
        this.startX = e.clientX;
        this.startWidth = this.card?.dataset['cardWidth'] ?? 'full';
        this.hasSwitched = false;

        document.body.style.cursor = 'ew-resize';
        document.body.classList.add('no-select');

        if (document.getElementById('resize-overlay') === null) {
            const overlay = document.createElement('div');
            overlay.id = 'resize-overlay';
            overlay.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:ew-resize;';
            document.body.appendChild(overlay);
        }
    }

    private move(e: MouseEvent) {
        if (!this.isResizing || !this.card) return;
        const delta = e.clientX - this.startX;
        const threshold = 100;

        if (this.hasSwitched) return;

        if (this.startWidth === 'full' && delta < -threshold) {
            this.card.dataset['cardWidth'] = 'half';
            this.hasSwitched = true;
            this.save();
        } else if (this.startWidth === 'half' && delta > threshold) {
            this.card.dataset['cardWidth'] = 'full';
            this.hasSwitched = true;
            this.save();
        }
    }

    private stop() {
        if (this.isResizing) {
            this.isResizing = false;
            this.card = null;
            document.body.style.cursor = '';
            document.body.classList.remove('no-select');
            document.getElementById('resize-overlay')?.remove();
        }
    }

    private save() {
        if (this.card !== null) {
            const id = this.card.dataset['cardId'];
            const width = this.card.dataset['cardWidth'] ?? 'full';
            if (id !== undefined && id !== '') this.onSave(id, width);
        }
    }
}
