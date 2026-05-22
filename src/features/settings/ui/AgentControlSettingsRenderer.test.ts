import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentControlSettingsRenderer } from './AgentControlSettingsRenderer';
import type { SettingsService } from '../services/SettingsService';
import type { AgentControlState } from '@/shared/types/bindings';
import type { LoggerService } from '@/infrastructure/logging/LoggerService';
import type { IAppSettingsUIContext } from './SettingsContext';

function state(overrides: Partial<AgentControlState> = {}): AgentControlState {
    return {
        enabled: false,
        apiBaseUrl: 'http://127.0.0.1:17878',
        profiles: [],
        audit: [],
        approvals: [],
        ...overrides,
    };
}

describe('AgentControlSettingsRenderer', () => {
    let service: Pick<
        SettingsService,
        | 'getAgentControlState'
        | 'setAgentControlEnabled'
        | 'createAgentProfile'
        | 'rotateAgentProfile'
        | 'copyAgentProfileToken'
        | 'revokeAgentProfile'
        | 'deleteAgentProfile'
        | 'decideAgentApproval'
    >;
    let context: IAppSettingsUIContext;
    let translations: Record<string, string>;

    beforeEach(() => {
        document.body.innerHTML = '<div id="agent-control-panel"></div>';
        vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
        translations = {
            'ui.launcher.settings.agent_control_create_profile': 'Create Trusted Local',
            'ui.launcher.settings.agent_control_trusted_local': 'Trusted Local',
            'ui.launcher.settings.agent_control_create_full_access': 'Create Full Access',
            'ui.launcher.settings.agent_control_full_access': 'Full Access',
            'ui.launcher.settings.agent_control_connection': 'Connection',
            'ui.launcher.settings.agent_control_base_url': 'Base URL',
            'ui.launcher.settings.agent_control_token_once': 'Token shown once',
            'ui.launcher.settings.agent_control_copy_token': 'Copy token',
            'ui.launcher.settings.agent_control_show_token': 'Show token',
            'ui.launcher.settings.agent_control_profiles': 'Agents',
            'ui.launcher.settings.agent_control_no_profiles': 'No agents yet',
            'ui.launcher.settings.agent_control_approvals': 'Approvals',
            'ui.launcher.settings.agent_control_no_approvals': 'No pending approvals',
            'ui.launcher.settings.agent_control_deny': 'Deny',
            'ui.launcher.settings.agent_control_delete_profile': 'Delete',
            'ui.launcher.settings.agent_control_confirm_action': 'Confirm',
            'ui.launcher.settings.agent_control_revoked': 'Revoked',
            'ui.launcher.settings.agent_control_active': 'Active',
            'ui.launcher.settings.agent_control_rotate': 'Rotate',
            'ui.launcher.settings.agent_control_revoke': 'Revoke',
            'ui.launcher.settings.agent_control_never_seen': 'Never connected',
            'ui.launcher.settings.agent_control_scope_observe': 'observe',
            'ui.launcher.settings.agent_control_scope_operate': 'operate',
            'ui.launcher.settings.agent_control_scope_configure': 'configure',
            'ui.launcher.settings.agent_control_scope_draft-create': 'draft-create',
            'ui.launcher.settings.agent_control_scope_full-access': 'full access',
        };
        service = {
            getAgentControlState: vi.fn().mockResolvedValue(state()),
            setAgentControlEnabled: vi.fn().mockResolvedValue(state({ enabled: true })),
            createAgentProfile: vi.fn().mockResolvedValue({
                profile: {
                    id: 'agent-1',
                    name: 'Trusted Local',
                    scopes: ['observe', 'operate', 'configure', 'draft-create'],
                    tokenPrefix: 'axl_agent_abc',
                    createdAt: '2026-05-22T00:00:00Z',
                    lastSeenAt: null,
                    revoked: false,
                },
            }),
            rotateAgentProfile: vi.fn(),
            copyAgentProfileToken: vi.fn().mockResolvedValue(undefined),
            revokeAgentProfile: vi.fn(),
            deleteAgentProfile: vi.fn().mockResolvedValue(state()),
            decideAgentApproval: vi.fn(),
        };
        context = {
            t: (key: string, fallback = '') => translations[key] ?? fallback,
            showToast: vi.fn(),
            toggleNavItem: vi.fn(),
            toggleMonitorItem: vi.fn(),
            i18nUI: { applyTranslations: vi.fn() },
        } as unknown as IAppSettingsUIContext;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a Trusted Local profile without revealing the one-time token immediately', async () => {
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Create Trusted Local');
        });

        const createButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Create Trusted Local');
        createButton?.click();

        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('🔒');
        });
        expect(document.body.textContent).not.toContain('axl_agent_abc_secret');
        expect(service.createAgentProfile).toHaveBeenCalledWith('Trusted Local', [
            'observe',
            'operate',
            'configure',
            'draft-create',
        ]);

        const copyTokenButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.getAttribute('aria-label') === 'Copy token');
        copyTokenButton?.click();
        await vi.waitFor(() => {
            expect(service.copyAgentProfileToken).toHaveBeenCalledWith('agent-1');
        });
        expect(document.body.textContent).not.toContain('axl_agent_abc_secret');
    });

    it('renders pending approval requests and denies without mutating directly', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                approvals: [
                    {
                        id: 'approval-1',
                        agentId: 'agent-1',
                        agentName: 'Codex',
                        action: 'package.install',
                        target: 'demo',
                        diff: 'Install demo',
                        risk: 'dangerous',
                        status: 'pending',
                        createdAt: '2026-05-22T00:00:00Z',
                        decidedAt: null,
                    },
                ],
            }),
        );
        service.decideAgentApproval = vi.fn().mockResolvedValue(state());
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('package.install');
        });

        const denyButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
            (button) => button.textContent === 'Deny',
        );
        denyButton?.click();

        await vi.waitFor(() => {
            expect(service.decideAgentApproval).toHaveBeenCalledWith('approval-1', false);
        });
    });

    it('creates a manual Full Access profile only after confirmation', async () => {
        service.createAgentProfile = vi.fn().mockResolvedValue({
            profile: {
                id: 'agent-full',
                name: 'Full Access',
                scopes: ['full-access'],
                tokenPrefix: 'axl_agent_full',
                createdAt: '2026-05-22T00:00:00Z',
                lastSeenAt: null,
                revoked: false,
            },
        });
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Create Full Access');
        });

        const fullAccessButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Create Full Access');
        fullAccessButton?.click();

        expect(service.createAgentProfile).not.toHaveBeenCalled();
        expect(fullAccessButton?.textContent).toBe('Confirm');
        fullAccessButton?.click();

        await vi.waitFor(() => {
            expect(service.createAgentProfile).toHaveBeenCalledWith('Full Access', ['full-access']);
        });
        expect(globalThis.confirm).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('🔒');
        });
        expect(document.body.textContent).not.toContain('axl_agent_full_secret');
    });

    it('keeps audit entries out of the settings panel', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                audit: [
                    {
                        id: 'audit-1',
                        actorId: 'agent-1',
                        actorName: 'Trusted Local',
                        action: 'launcher.open-page',
                        target: 'console',
                        result: 'success',
                        createdAt: '2026-05-22T00:00:00Z',
                    },
                ],
            }),
        );
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Connection');
        });

        expect(document.body.textContent).not.toContain('Action log');
        expect(document.body.textContent).not.toContain('launcher.open-page');
    });

    it('keeps revoked profiles visible without offering another revoke action', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                profiles: [
                    {
                        id: 'agent-1',
                        name: 'Trusted Local',
                        scopes: ['observe', 'operate'],
                        tokenPrefix: 'axl_agent_revoked',
                        createdAt: '2026-05-22T00:00:00Z',
                        lastSeenAt: null,
                        revoked: true,
                    },
                ],
            }),
        );
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Revoked');
        });

        const row = document.querySelector('.agent-control-row');
        if (row === null) {
            throw new Error('Expected revoked profile row to render');
        }
        expect(row.textContent).toContain('Rotate');
        expect(row.textContent).toContain('Delete');
        const buttons = Array.from(row.querySelectorAll('button')).map((button) =>
            button.textContent.trim(),
        );
        expect(buttons).toEqual(['Rotate', 'Delete']);
    });

    it('deletes profiles after confirmation', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                profiles: [
                    {
                        id: 'agent-1',
                        name: 'Trusted Local',
                        scopes: ['observe'],
                        tokenPrefix: 'axl_agent_delete',
                        createdAt: '2026-05-22T00:00:00Z',
                        lastSeenAt: null,
                        revoked: false,
                    },
                ],
            }),
        );
        service.deleteAgentProfile = vi.fn().mockResolvedValue(state());
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Delete');
        });

        const deleteButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Delete');
        deleteButton?.click();

        expect(service.deleteAgentProfile).not.toHaveBeenCalled();
        expect(deleteButton?.textContent).toBe('Confirm');
        deleteButton?.click();

        await vi.waitFor(() => {
            expect(service.deleteAgentProfile).toHaveBeenCalledWith('agent-1');
        });
    });
});
