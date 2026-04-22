type ConsoleInteractionHelperDeps = {
    translate: (key: string, fallback: string) => string;
    registerCleanup: (cleanup: () => void) => void;
    getDropzoneResetTimeout: () => ReturnType<typeof setTimeout> | null;
    setDropzoneResetTimeout: (timeout: ReturnType<typeof setTimeout> | null) => void;
};

export class ConsoleInteractionHelper {
    public constructor(private readonly _deps: ConsoleInteractionHelperDeps) {}

    public bindSliders(): void {
        this._bindSlider('.debug-slider-1', '.debug-slider-1-value');
        this._bindSlider('.debug-slider-animated', '.debug-slider-value');
        this._bindSlider('.debug-slider-3', '.debug-slider-3-value');
    }

    public bindDraggable(): void {
        const draggable = document.querySelector('.debug-draggable');
        if (!(draggable instanceof HTMLElement)) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;

        const handleMouseDown = (event: MouseEvent) => {
            isDragging = true;
            startX = event.clientX;
            startY = event.clientY;
            const rect = draggable.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            draggable.style.position = 'fixed';
            draggable.style.zIndex = '10000';
            draggable.style.cursor = 'grabbing';
            event.preventDefault();
            event.stopPropagation();
        };

        const handleMouseMove = (event: MouseEvent) => {
            if (!isDragging) return;
            event.preventDefault();
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            draggable.style.left = `${String(initialX + dx)}px`;
            draggable.style.top = `${String(initialY + dy)}px`;
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            draggable.style.cursor = 'move';
        };

        draggable.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        this._deps.registerCleanup(() => {
            draggable.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        });
    }

    public bindDropzone(): void {
        const dropzone = document.querySelector('.debug-dropzone');
        if (!(dropzone instanceof HTMLElement)) return;

        const handleDragOver = (event: DragEvent) => {
            event.preventDefault();
            dropzone.classList.add('drag-over');
        };

        const handleDragLeave = () => {
            dropzone.classList.remove('drag-over');
        };

        const handleDrop = (event: DragEvent) => {
            event.preventDefault();
            dropzone.classList.remove('drag-over');
            dropzone.textContent = this._deps.translate(
                'ui.debug.drag_drop.dragged',
                'Item dragged!',
            );

            const previousTimeout = this._deps.getDropzoneResetTimeout();
            if (previousTimeout !== null) {
                clearTimeout(previousTimeout);
            }

            const nextTimeout = setTimeout(() => {
                dropzone.textContent = this._deps.translate(
                    'ui.debug.drag_drop.drop_here',
                    'Drop here',
                );
                this._deps.setDropzoneResetTimeout(null);
            }, 2000);

            this._deps.setDropzoneResetTimeout(nextTimeout);
        };

        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('dragleave', handleDragLeave);
        dropzone.addEventListener('drop', handleDrop);

        this._deps.registerCleanup(() => {
            dropzone.removeEventListener('dragover', handleDragOver);
            dropzone.removeEventListener('dragleave', handleDragLeave);
            dropzone.removeEventListener('drop', handleDrop);
        });
    }

    private _bindSlider(sliderSelector: string, valueSelector: string): void {
        const slider = document.querySelector(sliderSelector);
        const valueElement = document.querySelector(valueSelector);
        if (!(slider instanceof HTMLElement) || !(valueElement instanceof HTMLElement)) {
            return;
        }

        const handleInput = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            valueElement.textContent = `${target.value}%`;
        };

        slider.addEventListener('input', handleInput);
        this._deps.registerCleanup(() => {
            slider.removeEventListener('input', handleInput);
        });
    }
}
