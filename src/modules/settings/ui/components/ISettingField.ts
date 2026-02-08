export interface ISettingField<T = unknown> {
    render(): HTMLElement;
    getValue(): T;
    onChange(cb: (val: T) => void): void;
}
