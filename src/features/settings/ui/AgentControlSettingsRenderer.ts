import type {
    AgentApprovalRequest,
    AgentAuditEntry,
    AgentControlState,
    AgentProfile,
    AgentScope,
} from '@/shared/types/bindings';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAppSettingsUIContext } from './SettingsContext';
import type { SettingsService } from '../services/SettingsService';

type AgentControlRuntime = {
    copyText: (text: string) => Promise<void>;
};

type OneTimeToken = {
    profileId: string;
    token: string;
};

const TRUSTED_LOCAL_SCOPES: AgentScope[] = ['observe', 'operate', 'configure', 'draft-create'];

export class AgentControlSettingsRenderer {
    private _context: IAppSettingsUIContext | null = null;
    private _panel: HTMLElement | null = null;
    private _state: AgentControlState | null = null;
    private _oneTimeToken: OneTimeToken | null = null;
    private _isDestroyed = false;
    private _isBusy = false;

    public constructor(
        private readonly _service: SettingsService,
        private readonly _tracer: Pick<LoggerService, 'error' | 'warn'>,
        private readonly _runtime: AgentControlRuntime,
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

    public destroy(): void {
        this._isDestroyed = true;
        this._context = null;
        this._panel = null;
        this._state = null;
        this._oneTimeToken = null;
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
        this._replacePanel(
            this._element('div', 'agent-control-empty', this._t('loading', 'Loading...')),
        );
    }

    private _renderError(): void {
        this._replacePanel(
            this._element(
                'div',
                'agent-control-empty agent-control-empty--error',
                this._t('load_failed', 'Failed to load Agent Control'),
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
        root.append(
            this._renderHeader(state),
            this._renderConnection(state),
            this._renderProfiles(state.profiles),
            this._renderApprovals(state.approvals),
            this._renderAudit(state.audit),
        );
        this._replacePanel(root);
    }

    private _renderHeader(state: AgentControlState): HTMLElement {
        const header = this._element('div', 'agent-control-header');
        const status = this._element(
            'span',
            `agent-control-status ${state.enabled ? 'is-on' : 'is-off'}`,
            state.enabled ? this._t('enabled', 'Enabled') : this._t('disabled', 'Disabled'),
        );
        const toggle = this._button(
            state.enabled ? this._t('disable', 'Disable') : this._t('enable', 'Enable'),
            'agent-control-btn',
            () => {
                void this._run(async () => {
                    this._state = await this._service.setAgentControlEnabled(!state.enabled);
                    this._toast(
                        state.enabled
                            ? this._t('disabled', 'Disabled')
                            : this._t('enabled', 'Enabled'),
                        'success',
                    );
                    this._render();
                });
            },
        );
        header.append(status, toggle);
        return header;
    }

    private _renderConnection(state: AgentControlState): HTMLElement {
        const section = this._section(this._t('connection', 'Connection'));
        const base = this._element('div', 'agent-control-code', state.apiBaseUrl);
        const copyBase = this._button(this._t('copy_base', 'Copy URL'), 'agent-control-btn', () => {
            void this._copy(state.apiBaseUrl);
        });
        const copyConfig = this._button(
            this._t('copy_config', 'Copy config'),
            'agent-control-btn agent-control-btn--primary',
            () => {
                void this._copy(this._configText(state));
            },
        );
        const create = this._button(
            this._t('create_profile', 'Create Trusted Local'),
            'agent-control-btn agent-control-btn--primary',
            () => {
                void this._run(async () => {
                    const response = await this._service.createAgentProfile(
                        this._t('trusted_local', 'Trusted Local'),
                        TRUSTED_LOCAL_SCOPES,
                    );
                    this._oneTimeToken = {
                        profileId: response.profile.id,
                        token: response.token,
                    };
                    this._state = await this._service.getAgentControlState();
                    this._toast(this._t('profile_created', 'Profile created'), 'success');
                    this._render();
                });
            },
        );
        const actions = this._element('div', 'agent-control-actions');
        actions.append(copyBase, copyConfig, create);
        section.append(base, actions);

        if (this._oneTimeToken !== null) {
            section.append(this._renderOneTimeToken());
        }

        return section;
    }

    private _renderOneTimeToken(): HTMLElement {
        const token = this._oneTimeToken;
        const box = this._element('div', 'agent-control-token');
        const label = this._element(
            'div',
            'agent-control-token-label',
            this._t('token_once', 'Token shown once'),
        );
        const value = this._element('div', 'agent-control-code', token?.token ?? '');
        const copy = this._button(this._t('copy_token', 'Copy token'), 'agent-control-btn', () => {
            if (token !== null) {
                void this._copy(token.token);
            }
        });
        box.append(label, value, copy);
        return box;
    }

    private _renderProfiles(profiles: AgentProfile[]): HTMLElement {
        const section = this._section(this._t('profiles', 'Agents'));
        if (profiles.length === 0) {
            section.append(
                this._element(
                    'div',
                    'agent-control-empty',
                    this._t('no_profiles', 'No agents yet'),
                ),
            );
            return section;
        }

        const list = this._element('div', 'agent-control-list');
        profiles.forEach((profile) => {
            const row = this._element('div', 'agent-control-row');
            const main = this._element('div', 'agent-control-row-main');
            main.append(
                this._element('div', 'agent-control-row-title', profile.name),
                this._element(
                    'div',
                    'agent-control-row-meta',
                    `${profile.revoked ? this._t('revoked', 'Revoked') : this._t('active', 'Active')} · ${profile.tokenPrefix} · ${this._lastSeen(profile.lastSeenAt)}`,
                ),
                this._renderScopes(profile.scopes),
            );
            const actions = this._element('div', 'agent-control-row-actions');
            actions.append(
                this._button(this._t('rotate', 'Rotate'), 'agent-control-btn', () => {
                    void this._run(async () => {
                        const response = await this._service.rotateAgentProfile(profile.id);
                        this._oneTimeToken = {
                            profileId: response.profile.id,
                            token: response.token,
                        };
                        this._state = await this._service.getAgentControlState();
                        this._toast(this._t('token_rotated', 'Token rotated'), 'success');
                        this._render();
                    });
                }),
            );
            if (!profile.revoked) {
                actions.append(
                    this._button(this._t('revoke', 'Revoke'), 'agent-control-btn', () => {
                        void this._run(async () => {
                            this._state = await this._service.revokeAgentProfile(profile.id);
                            if (this._oneTimeToken?.profileId === profile.id) {
                                this._oneTimeToken = null;
                            }
                            this._toast(this._t('profile_revoked', 'Profile revoked'), 'success');
                            this._render();
                        });
                    }),
                );
            }
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
        const section = this._section(this._t('approvals', 'Approvals'));
        const pending = approvals.filter((approval) => approval.status === 'pending');
        if (pending.length === 0) {
            section.append(
                this._element(
                    'div',
                    'agent-control-empty',
                    this._t('no_approvals', 'No pending approvals'),
                ),
            );
            return section;
        }

        const list = this._element('div', 'agent-control-list');
        pending.forEach((approval) => {
            const row = this._element('div', 'agent-control-row agent-control-row--approval');
            const main = this._element('div', 'agent-control-row-main');
            main.append(
                this._element('div', 'agent-control-row-title', approval.action),
                this._element(
                    'div',
                    'agent-control-row-meta',
                    `${approval.agentName} · ${approval.target} · ${approval.risk}`,
                ),
                this._element('div', 'agent-control-diff', approval.diff),
            );
            const actions = this._element('div', 'agent-control-row-actions');
            actions.append(
                this._button(
                    this._t('approve', 'Approve'),
                    'agent-control-btn agent-control-btn--primary',
                    () => {
                        void this._decideApproval(approval.id, true);
                    },
                ),
                this._button(this._t('deny', 'Deny'), 'agent-control-btn', () => {
                    void this._decideApproval(approval.id, false);
                }),
            );
            row.append(main, actions);
            list.append(row);
        });
        section.append(list);
        return section;
    }

    private _renderAudit(audit: AgentAuditEntry[]): HTMLElement {
        const section = this._section(this._t('audit', 'Action log'));
        if (audit.length === 0) {
            section.append(
                this._element('div', 'agent-control-empty', this._t('no_audit', 'No actions yet')),
            );
            return section;
        }

        const list = this._element('div', 'agent-control-audit');
        audit.slice(0, 6).forEach((entry) => {
            const item = this._element(
                'div',
                'agent-control-audit-item',
                `${entry.actorName} · ${entry.action} · ${entry.target} · ${entry.result}`,
            );
            list.append(item);
        });
        section.append(list);
        return section;
    }

    private async _decideApproval(id: string, approved: boolean): Promise<void> {
        await this._run(async () => {
            this._state = await this._service.decideAgentApproval(id, approved);
            this._toast(
                approved
                    ? this._t('approval_approved', 'Approved')
                    : this._t('approval_denied', 'Denied'),
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
            this._toast(this._t('action_failed', 'Action failed'), 'error');
        } finally {
            this._isBusy = false;
            this._setButtonsDisabled(false);
        }
    }

    private async _copy(text: string): Promise<void> {
        try {
            await this._runtime.copyText(text);
            this._toast(this._t('copied', 'Copied'), 'success');
        } catch (error) {
            this._tracer.error('[AgentControlSettingsRenderer] Copy failed:', error);
            this._toast(this._t('copy_failed', 'Copy failed'), 'error');
        }
    }

    private _configText(state: AgentControlState): string {
        const token = this._oneTimeToken?.token ?? '<token>';
        return JSON.stringify(
            {
                name: this._t('trusted_local', 'Trusted Local'),
                baseUrl: state.apiBaseUrl,
                authorization: `Bearer ${token}`,
                scopes: TRUSTED_LOCAL_SCOPES,
            },
            null,
            2,
        );
    }

    private _section(title: string): HTMLElement {
        const section = this._element('section', 'agent-control-section');
        section.append(this._element('div', 'agent-control-section-title', title));
        return section;
    }

    private _button(label: string, className: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
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
            return this._t('never_seen', 'Never connected');
        }
        return `${this._t('last_seen', 'Last seen')} ${this._formatDate(value)}`;
    }

    private _formatDate(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleString();
    }

    private _scopeLabel(scope: AgentScope): string {
        return this._t(`scope_${scope}`, scope);
    }

    private _t(key: string, fallback: string): string {
        return this._context?.t(`ui.launcher.settings.agent_control_${key}`, fallback) ?? fallback;
    }

    private _toast(message: string, type: 'success' | 'error' | 'info'): void {
        this._context?.showToast(message, type);
    }
}
