export class CardResizer {
    private isResizing = false;
    private card: HTMLElement | null = null;
    private startX = 0;
    private startWidth = 'full';
    private hasSwitched = false;

    constructor(private readonly onSave: (id: string, width: string) => void) {}

    init() {
        document.querySelectorAll('.resize-handle').forEach((h) => {
            h.addEventListener('mousedown', (e) => {
                this.start(e as MouseEvent, h as HTMLElement);
            });
        });

        document.addEventListener('mousemove', (e) => {
            this.move(e);
        });
        document.addEventListener('mouseup', () => {
            this.stop();
        });
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

        const overlay = document.createElement('div');
        overlay.id = 'resize-overlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:ew-resize;';
        document.body.appendChild(overlay);
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
