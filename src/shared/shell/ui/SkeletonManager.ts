/**
 * @class SkeletonManager
 * @description Manages skeleton loading states for module grids.
 */
export class SkeletonManager {
    /**
     * Displays skeleton loaders for a container.
     * @param {string} containerId - The ID of the container.
     * @param {number} [count=3] - Number of skeletons to show.
     */
    public show(containerId: string, count = 3): void {
        const container = document.getElementById(containerId);
        if (container === null) return;

        for (let i = 1; i <= count; i++) {
            const skeleton = document.getElementById(`${containerId}-skeleton-${String(i)}`);
            if (skeleton !== null) {
                skeleton.style.display = 'block';
            }
        }
    }

    /**
     * Hides skeleton loaders for a container.
     * @param {string} containerId - The ID of the container.
     * @param {number} [count=3] - Number of skeletons to hide.
     */
    public hide(containerId: string, count = 3): void {
        for (let i = 1; i <= count; i++) {
            const skeleton = document.getElementById(`${containerId}-skeleton-${String(i)}`);
            if (skeleton !== null) {
                skeleton.style.display = 'none';
            }
        }
    }

    /**
     * Toggles the loading state of a button.
     * @param {HTMLButtonElement | null} button - The button to modify.
     * @param {boolean} [loading=true] - Whether it should be in loading state.
     */
    public setButtonLoading(button: HTMLButtonElement | null, loading = true): void {
        if (button === null) return;
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }
}
