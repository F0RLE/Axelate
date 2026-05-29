import type {
    AgentApprovalRequest,
    AgentControlState,
    AgentProfile,
    AgentScope,
} from '@/shared/types/bindings';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAppSettingsUIContext } from './SettingsContext';
import type { SettingsService } from '../services/SettingsService';

const TRUSTED_LOCAL_SCOPES: AgentScope[] = ['observe', 'operate', 'configure', 'draft-create'];
const FULL_ACCESS_SCOPES: AgentScope[] = ['full-access'];
const AGENT_CONTROL_DOCS_URL =
    'https://github.com/F0RLE/Axelate/blob/nightly/docs/localization/en/AGENT_CONTROL.md';

export class AgentControlSettingsRenderer {
    private _context: IAppSettingsUIContext | null = null;
    private _panel: HTMLElement | null = null;
    private _state: AgentControlState | null = null;
    private _pendingTokenProfileId: string | null = null;
    private _confirmResetTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    private _isDestroyed = false;
    private _isBusy = false;
    private readonly _selectedLocalScopes = new Set<AgentScope>(TRUSTED_LOCAL_SCOPES);

    public constructor(
        private readonly _service: SettingsService,
        private readonly _tracer: Pick<LoggerService, 'error' | 'warn'>,
    ) {}

    public init(context: IAppSettingsUIContext): void {
        if (this._isDestroyed) return;
        this._context = context;
        const panel = document.getElementById('agent-control-panel');
        if (!(panel instanceof HTMLElement)) {
            this._tracer.warn('[AgentControlSettingsRenderer] #agent-control-panel not found');
            return;
        }
        this._panel = panel;
        this._renderLoading();
        void this._refresh();
    }

    public refresh(): void {
        if (this._isDestroyed || this._panel === null) {
            return;
        }
        void this._refresh();
    }

    public destroy(): void {
        this._isDestroyed = true;
        this._context = null;
        this._panel = null;
        this._state = null;
        this._pendingTokenProfileId = null;
        this._clearPendingConfirmation();
    }

    private async _refresh(): Promise<void> {
        try {
            this._state = await this._service.getAgentControlState();
            this._render();
        } catch (error) {
            this._tracer.error('[AgentControlSettingsRenderer] Failed to refresh:', error);
            this._renderError();
        }
    }

    private _renderLoading(): void {
        this._replacePanel(this._element('div', 'agent-control-empty', this._t('loading')));
    }

    private _renderError(): void {
        this._replacePanel(
            this._element(
                'div',
                'agent-control-empty agent-control-empty--error',
                this._t('load_failed'),
            ),
        );
    }

    private _render(): void {
        const state = this._state;
        if (state === null) {
            this._renderLoading();
            return;
        }

        const root = this._element('div', 'agent-control');
        root.classList.toggle('is-enabled', state.enabled);
        root.append(
            this._renderHeader(state),
            this._renderConnection(state),
            this._renderProfiles(state.profiles),
            this._renderApprovals(state.approvals),
        );
        this._replacePanel(root);
    }

    private _renderHeader(state: AgentControlState): HTMLElement {
        const header = this._element('div', 'agent-control-header');
        const help = this._helpLink();
        const toggle = this._button(
            state.enabled ? this._t('disable') : this._t('enable'),
            `agent-control-btn agent-control-engine-btn ${state.enabled ? 'stop-btn' : 'active-module-btn'}`,
            () => {
                void this._run(async () => {
                    this._state = await this._service.setAgentControlEnabled(!state.enabled);
                    this._toast(
                        state.enabled ? this._t('disabled') : this._t('enabled'),
                        'success',
                    );
                    this._render();
                });
            },
        );
        header.append(help, toggle);
        return header;
    }

    private _renderConnection(state: AgentControlState): HTMLElement {
        const create = this._button(
            this._t('create_profile'),
            'agent-control-btn agent-control-btn--primary',
            () => {
                void this._run(async () => {
                    const scopes = Array.from(this._selectedLocalScopes);
                    const response = await this._service.createAgentProfile(
                        this._t('trusted_local'),
                        scopes.length > 0 ? scopes : TRUSTED_LOCAL_SCOPES,
                    );
                    this._pendingTokenProfileId = response.profile.id;
                    this._state = await this._service.getAgentControlState();
                    this._toast(this._t('profile_created'), 'success');
                    this._render();
                });
            },
        );
        create.title = this._t('create_profile_hint');
        create.setAttribute('aria-label', this._t('create_profile_hint'));
        const createFullAccess = this._button(
            this._t('create_full_access'),
            'agent-control-btn agent-control-btn--danger',
            (button) => {
                if (!this._confirmDangerousButton(button)) {
                    return;
                }
                void this._run(async () => {
                    const response = await this._service.createAgentProfile(
                        this._t('full_access'),
                        FULL_ACCESS_SCOPES,
                    );
                    this._pendingTokenProfileId = response.profile.id;
                    this._state = await this._service.getAgentControlState();
                    this._toast(this._t('profile_created'), 'success');
                    this._render();
                });
            },
        );
        createFullAccess.title = this._t('create_full_access_hint');
        createFullAccess.setAttribute('aria-label', this._t('create_full_access_hint'));
        const section = this._section(this._t('connection'), [create, createFullAccess]);
        section.append(this._renderScopePicker());
        const endpoint = this._element('div', 'agent-control-endpoint');
        const baseUrlInput = document.createElement('input');
        baseUrlInput.className = 'agent-control-url-input';
        baseUrlInput.type = 'text';
        baseUrlInput.inputMode = 'url';
        baseUrlInput.value = state.apiBaseUrl;
        baseUrlInput.spellcheck = false;
        baseUrlInput.autocomplete = 'off';
        baseUrlInput.addEventListener('blur', () => {
            baseUrlInput.value = state.apiBaseUrl;
        });
        baseUrlInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'Enter') {
                baseUrlInput.blur();
            }
        });
        endpoint.append(
            this._element('div', 'agent-control-field-label', this._t('base_url')),
            baseUrlInput,
        );
        section.append(endpoint);

        return section;
    }

    private _renderScopePicker(): HTMLElement {
        const wrap = this._element('div', 'agent-control-permissions');
        const label = this._element(
            'div',
            'agent-control-field-label agent-control-field-label--icon',
            '⚙️',
        );
        label.title = this._t('permissions');
        label.setAttribute('aria-label', this._t('permissions'));
        wrap.append(label);
        const list = this._element('div', 'agent-control-scope-picker');
        TRUSTED_LOCAL_SCOPES.forEach((scope) => {
            const selected = this._selectedLocalScopes.has(scope);
            const button = this._button(
                this._scopeLabel(scope),
                `agent-control-scope-btn ${selected ? 'is-selected' : ''}`,
                () => {
                    if (this._selectedLocalScopes.has(scope)) {
                        this._selectedLocalScopes.delete(scope);
                    } else {
                        this._selectedLocalScopes.add(scope);
                    }
                    this._render();
                },
            );
            button.title = this._scopeHint(scope);
            button.setAttribute('aria-pressed', String(selected));
            button.setAttribute('aria-label', this._scopeHint(scope));
            list.append(button);
        });
        wrap.append(list);
        return wrap;
    }

    private _renderProfiles(profiles: AgentProfile[]): HTMLElement {
        const section = this._section(this._t('profiles'));
        if (profiles.length === 0) {
            section.append(this._element('div', 'agent-control-empty', this._t('no_profiles')));
            return section;
        }

        const list = this._element('div', 'agent-control-list');
        profiles.forEach((profile) => {
            const row = this._element(
                'div',
                `agent-control-row ${profile.revoked ? 'is-revoked' : 'is-active'}`,
            );
            const main = this._element('div', 'agent-control-row-main');
            const titleLine = this._element('div', 'agent-control-title-line');
            titleLine.append(
                this._element('div', 'agent-control-row-title', profile.name),
                this._element(
                    'span',
                    `agent-control-row-status ${profile.revoked ? 'is-revoked' : 'is-active'}`,
                    profile.revoked ? this._t('revoked') : this._t('active'),
                ),
            );
            main.append(
                titleLine,
                this._element(
                    'div',
                    'agent-control-row-meta',
                    `${profile.tokenPrefix} · ${this._lastSeen(profile.lastSeenAt)}`,
                ),
                this._renderScopes(profile.scopes),
            );
            const actions = this._element('div', 'agent-control-row-actions');
            if (this._pendingTokenProfileId === profile.id && !profile.revoked) {
                const copyToken = this._button(
                    '📋',
                    'agent-control-btn agent-control-btn--icon',
                    () => {
                        void this._run(async () => {
                            await this._service.copyAgentProfileToken(profile.id);
                            if (this._pendingTokenProfileId === profile.id) {
                                this._pendingTokenProfileId = null;
                            }
                            this._toast(this._t('copied'), 'success');
                            this._render();
                        });
                    },
                );
                copyToken.title = this._t('copy_token');
                copyToken.setAttribute('aria-label', this._t('copy_token'));
                actions.append(copyToken);
            }
            if (!profile.revoked) {
                const rotate = this._button(this._t('rotate'), 'agent-control-btn', () => {
                    void this._run(async () => {
                        const response = await this._service.rotateAgentProfile(profile.id);
                        this._pendingTokenProfileId = response.profile.id;
                        this._state = await this._service.getAgentControlState();
                        this._toast(this._t('token_rotated'), 'success');
                        this._render();
                    });
                });
                rotate.title = this._t('rotate_hint');
                rotate.setAttribute('aria-label', this._t('rotate_hint'));
                actions.append(rotate);
            }
            const remove = this._button(
                this._t('delete_profile'),
                'agent-control-btn agent-control-btn--danger',
                (button) => {
                    if (!this._confirmDangerousButton(button)) {
                        return;
                    }
                    void this._run(async () => {
                        if (this._pendingTokenProfileId === profile.id) {
                            this._pendingTokenProfileId = null;
                        }
                        this._state = await this._service.deleteAgentProfile(profile.id);
                        this._toast(this._t('profile_deleted'), 'success');
                        this._render();
                    });
                },
            );
            remove.title = this._t('delete_profile_hint');
            remove.setAttribute('aria-label', this._t('delete_profile_hint'));
            actions.append(remove);
            row.append(main, actions);
            list.append(row);
        });
        section.append(list);
        return section;
    }

    private _renderScopes(scopes: AgentScope[]): HTMLElement {
        const wrap = this._element('div', 'agent-control-scopes');
        scopes.forEach((scope) => {
            wrap.append(this._element('span', 'agent-control-scope', this._scopeLabel(scope)));
        });
        return wrap;
    }

    private _renderApprovals(approvals: AgentApprovalRequest[]): HTMLElement {
        const section = this._section(this._t('approvals'));
        const pending = approvals.filter((approval) => approval.status === 'pending');
        if (pending.length === 0) {
            section.append(this._element('div', 'agent-control-empty', this._t('no_approvals')));
            return section;
        }

        const list = this._element('div', 'agent-control-list');
        pending.forEach((approval) => {
            const row = this._element('div', 'agent-control-row agent-control-row--approval');
            const main = this._element('div', 'agent-control-row-main');
            const titleLine = this._element('div', 'agent-control-title-line');
            titleLine.append(
                this._element('div', 'agent-control-row-title', approval.action),
                this._element('span', 'agent-control-risk', approval.risk),
            );
            main.append(
                titleLine,
                this._element(
                    'div',
                    'agent-control-row-meta',
                    `${approval.agentName} · ${approval.target}`,
                ),
                this._element('div', 'agent-control-diff', approval.diff),
            );
            const actions = this._element('div', 'agent-control-row-actions');
            actions.append(
                this._button(
                    this._t('approve'),
                    'agent-control-btn agent-control-btn--primary',
                    () => {
                        void this._decideApproval(approval.id, true);
                    },
                ),
                this._button(this._t('deny'), 'agent-control-btn', () => {
                    void this._decideApproval(approval.id, false);
                }),
            );
            row.append(main, actions);
            list.append(row);
        });
        section.append(list);
        return section;
    }

    private async _decideApproval(id: string, approved: boolean): Promise<void> {
        await this._run(async () => {
            this._state = await this._service.decideAgentApproval(id, approved);
            this._toast(
                approved ? this._t('approval_approved') : this._t('approval_denied'),
                'success',
            );
            this._render();
        });
    }

    private async _run(action: () => Promise<void>): Promise<void> {
        if (this._isBusy) return;
        this._isBusy = true;
        this._setButtonsDisabled(true);
        try {
            await action();
        } catch (error) {
            this._tracer.error('[AgentControlSettingsRenderer] Action failed:', error);
            this._toast(this._t('action_failed'), 'error');
        } finally {
            this._isBusy = false;
            this._setButtonsDisabled(false);
        }
    }

    private _section(title: string, actions: HTMLButtonElement[] = []): HTMLElement {
        const section = this._element('section', 'agent-control-section');
        const header = this._element('div', 'agent-control-section-header');
        header.append(this._element('div', 'agent-control-section-title', title));
        if (actions.length > 0) {
            const actionWrap = this._element('div', 'agent-control-actions');
            actionWrap.append(...actions);
            header.append(actionWrap);
        }
        section.append(header);
        return section;
    }

    private _confirmDangerousButton(button: HTMLButtonElement): boolean {
        if (button.dataset['confirming'] === 'true') {
            this._clearPendingConfirmation();
            return true;
        }

        this._clearPendingConfirmation();
        button.dataset['confirming'] = 'true';
        button.dataset['label'] = button.textContent;
        button.classList.add('is-confirming');
        button.textContent = this._t('confirm_action');
        this._confirmResetTimer = globalThis.setTimeout(() => {
            this._resetConfirmingButton(button);
            this._confirmResetTimer = null;
        }, 2400);
        return false;
    }

    private _clearPendingConfirmation(): void {
        if (this._confirmResetTimer !== null) {
            globalThis.clearTimeout(this._confirmResetTimer);
            this._confirmResetTimer = null;
        }
        this._panel
            ?.querySelectorAll<HTMLButtonElement>('.agent-control-btn.is-confirming')
            .forEach((button) => {
                this._resetConfirmingButton(button);
            });
    }

    private _resetConfirmingButton(button: HTMLButtonElement): void {
        button.classList.remove('is-confirming');
        delete button.dataset['confirming'];
        const label = button.dataset['label'];
        if (label !== undefined) {
            button.textContent = label;
            delete button.dataset['label'];
        }
    }

    private _button(
        label: string,
        className: string,
        onClick: (button: HTMLButtonElement) => void,
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', () => {
            onClick(button);
        });
        return button;
    }

    private _helpLink(): HTMLAnchorElement {
        const label = this._t('docs_help');
        const link = document.createElement('a');
        link.className = 'module-action-badge left integration-help-badge agent-control-help';
        link.href = AGENT_CONTROL_DOCS_URL;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.title = label;
        link.setAttribute('aria-label', label);
        const icon = document.createElement('span');
        icon.className = 'badge-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '?';
        link.append(icon);
        return link;
    }

    private _element(
        tag: 'div' | 'span' | 'section',
        className: string,
        text?: string,
    ): HTMLElement {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    private _replacePanel(content: HTMLElement): void {
        this._panel?.replaceChildren(content);
    }

    private _setButtonsDisabled(disabled: boolean): void {
        this._panel?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
            button.disabled = disabled;
        });
    }

    private _lastSeen(value: string | null): string {
        if (value === null) {
            return this._t('never_seen');
        }
        return `${this._t('last_seen')} ${this._formatDate(value)}`;
    }

    private _formatDate(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleString();
    }

    private _scopeLabel(scope: AgentScope): string {
        return this._t(`scope_${scope}`);
    }

    private _scopeHint(scope: AgentScope): string {
        return this._t(`scope_${scope}_hint`);
    }

    private _t(key: string): string {
        const i18nKey = `ui.launcher.settings.agent_control_${key}`;
        return this._context?.t(i18nKey, i18nKey) ?? i18nKey;
    }

    private _toast(message: string, type: 'success' | 'error' | 'info'): void {
        this._context?.showToast(message, type);
    }
}
