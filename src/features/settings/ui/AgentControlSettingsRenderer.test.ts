import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentControlSettingsRenderer } from './AgentControlSettingsRenderer';
import type { SettingsService } from '../services/SettingsService';
import type { AgentControlState, AgentScope } from '@/shared/types/bindings';
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

function copyTokenButton(): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.getAttribute('aria-label') === 'Copy token',
    );
}

describe('AgentControlSettingsRenderer', () => {
    let service: Pick<
        SettingsService,
        | 'getAgentControlState'
        | 'setAgentControlEnabled'
        | 'createAgentProfile'
        | 'rotateAgentProfile'
        | 'copyAgentProfileToken'
        | 'deleteAgentProfile'
        | 'decideAgentApproval'
    >;
    let context: IAppSettingsUIContext;
    let translations: Record<string, string>;
    let currentState: AgentControlState;

    beforeEach(() => {
        document.body.innerHTML = '<div id="agent-control-panel"></div>';
        vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
        currentState = state();
        translations = {
            'ui.launcher.settings.agent_control_create_profile': 'Selected Permissions',
            'ui.launcher.settings.agent_control_trusted_local': 'Selected Permissions',
            'ui.launcher.settings.agent_control_create_full_access': 'Create Full Access',
            'ui.launcher.settings.agent_control_full_access': 'Full Access',
            'ui.launcher.settings.agent_control_connection': 'Connection',
            'ui.launcher.settings.agent_control_base_url': 'Base URL',
            'ui.launcher.settings.agent_control_token_once': 'Token shown once',
            'ui.launcher.settings.agent_control_copy_token': 'Copy token',
            'ui.launcher.settings.agent_control_copied': 'Copied',
            'ui.launcher.settings.agent_control_profiles': 'Agents',
            'ui.launcher.settings.agent_control_no_profiles': 'No agents yet',
            'ui.launcher.settings.agent_control_approvals': 'Approvals',
            'ui.launcher.settings.agent_control_no_approvals': 'No pending approvals',
            'ui.launcher.settings.agent_control_deny': 'Deny',
            'ui.launcher.settings.agent_control_delete_profile': 'Delete',
            'ui.launcher.settings.agent_control_delete_profile_hint': 'Delete this token',
            'ui.launcher.settings.agent_control_confirm_action': 'Confirm',
            'ui.launcher.settings.agent_control_revoked': 'Revoked',
            'ui.launcher.settings.agent_control_active': 'Active',
            'ui.launcher.settings.agent_control_create_profile_hint': 'Create token',
            'ui.launcher.settings.agent_control_create_full_access_hint': 'Create full token',
            'ui.launcher.settings.agent_control_rotate': 'Generate new token',
            'ui.launcher.settings.agent_control_rotate_hint': 'Create a new token',
            'ui.launcher.settings.agent_control_profile_created': 'Profile created',
            'ui.launcher.settings.agent_control_token_rotated': 'Token created',
            'ui.launcher.settings.agent_control_never_seen': 'Never connected',
            'ui.launcher.settings.agent_control_permissions': 'Permissions',
            'ui.launcher.settings.agent_control_scope_observe': 'observe',
            'ui.launcher.settings.agent_control_scope_observe_hint': 'read state',
            'ui.launcher.settings.agent_control_scope_operate': 'operate',
            'ui.launcher.settings.agent_control_scope_operate_hint': 'operate modules',
            'ui.launcher.settings.agent_control_scope_configure': 'configure',
            'ui.launcher.settings.agent_control_scope_configure_hint': 'change settings',
            'ui.launcher.settings.agent_control_scope_draft-create': 'draft-create',
            'ui.launcher.settings.agent_control_scope_draft-create_hint': 'create drafts',
            'ui.launcher.settings.agent_control_scope_full-access': 'full access',
            'ui.launcher.settings.agent_control_scope_full-access_hint': 'all permissions',
        };
        service = {
            getAgentControlState: vi.fn().mockImplementation(() => Promise.resolve(currentState)),
            setAgentControlEnabled: vi.fn().mockImplementation((enabled: boolean) => {
                currentState = state({ ...currentState, enabled });
                return Promise.resolve(currentState);
            }),
            createAgentProfile: vi
                .fn()
                .mockImplementation(
                    (name: string | null = null, scopes: AgentScope[] | null = null) => {
                        const profile = {
                            id: 'agent-1',
                            name: name ?? 'Trusted Local',
                            scopes:
                                scopes ??
                                ([
                                    'observe',
                                    'operate',
                                    'configure',
                                    'draft-create',
                                ] as AgentScope[]),
                            tokenPrefix: 'axl_agent_abc',
                            createdAt: '2026-05-22T00:00:00Z',
                            lastSeenAt: null,
                            revoked: false,
                        };
                        currentState = state({
                            ...currentState,
                            profiles: [...currentState.profiles, profile],
                        });
                        return Promise.resolve({ profile });
                    },
                ),
            rotateAgentProfile: vi.fn().mockImplementation((id: string) => {
                const profile = currentState.profiles.find((entry) => entry.id === id);
                if (profile === undefined) {
                    throw new Error('Missing profile');
                }
                const rotated = {
                    ...profile,
                    tokenPrefix: 'axl_agent_new',
                };
                currentState = state({
                    ...currentState,
                    profiles: currentState.profiles.map((entry) =>
                        entry.id === id ? rotated : entry,
                    ),
                });
                return Promise.resolve({ profile: rotated });
            }),
            copyAgentProfileToken: vi.fn().mockResolvedValue(undefined),
            deleteAgentProfile: vi.fn().mockImplementation((id: string) => {
                currentState = state({
                    ...currentState,
                    profiles: currentState.profiles.filter((profile) => profile.id !== id),
                });
                return Promise.resolve(currentState);
            }),
            decideAgentApproval: vi.fn().mockImplementation((id: string, approved: boolean) => {
                currentState = state({
                    ...currentState,
                    approvals: currentState.approvals.map((approval) =>
                        approval.id === id
                            ? {
                                  ...approval,
                                  status: approved ? 'approved' : 'denied',
                                  decidedAt: '2026-05-22T00:00:00Z',
                              }
                            : approval,
                    ),
                });
                return Promise.resolve(currentState);
            }),
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

    it('creates a Trusted Local profile and shows a copy token action for the new token', async () => {
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Selected Permissions');
        });

        const createButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Selected Permissions');
        createButton?.click();

        await vi.waitFor(() => {
            expect(copyTokenButton()).not.toBeUndefined();
        });
        expect(service.copyAgentProfileToken).not.toHaveBeenCalled();
        expect(service.createAgentProfile).toHaveBeenCalledWith('Selected Permissions', [
            'observe',
            'operate',
            'configure',
            'draft-create',
        ]);

        const copyButton = copyTokenButton();
        expect(copyButton?.textContent).toBe('📋');
        copyButton?.click();

        await vi.waitFor(() => {
            expect(service.copyAgentProfileToken).toHaveBeenCalledWith('agent-1');
        });
        expect(document.body.textContent).not.toContain('axl_agent_abc_secret');
        expect(context.showToast).toHaveBeenCalledWith('Profile created', 'success');
        expect(context.showToast).toHaveBeenCalledWith('Copied', 'success');
    });

    it('creates local access tokens with the selected permissions', async () => {
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(
                document.querySelector('.agent-control-field-label--icon')?.getAttribute('title'),
            ).toBe('Permissions');
        });

        const configureButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('.agent-control-scope-btn'),
        ).find((button) => button.textContent === 'configure');
        configureButton?.click();

        const createButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Selected Permissions');
        createButton?.click();

        await vi.waitFor(() => {
            expect(service.createAgentProfile).toHaveBeenCalledWith('Selected Permissions', [
                'observe',
                'operate',
                'draft-create',
            ]);
        });
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
        service.createAgentProfile = vi.fn().mockImplementation(() => {
            const profile = {
                id: 'agent-full',
                name: 'Full Access',
                scopes: ['full-access'] as AgentScope[],
                tokenPrefix: 'axl_agent_full',
                createdAt: '2026-05-22T00:00:00Z',
                lastSeenAt: null,
                revoked: false,
            };
            currentState = state({
                ...currentState,
                profiles: [...currentState.profiles, profile],
            });
            return Promise.resolve({ profile });
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
            expect(copyTokenButton()).not.toBeUndefined();
        });
        const copyButton = copyTokenButton();
        expect(copyButton?.textContent).toBe('📋');
        copyButton?.click();
        await vi.waitFor(() => {
            expect(service.copyAgentProfileToken).toHaveBeenCalledWith('agent-full');
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

    it('renders the Agent API base URL as an editable launcher-styled input', async () => {
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.querySelector('.agent-control-url-input')).not.toBeNull();
        });

        const input = document.querySelector<HTMLInputElement>('.agent-control-url-input');
        expect(input?.value).toBe('http://127.0.0.1:17878');
        expect(input?.readOnly).toBe(false);

        if (input === null) {
            throw new Error('Expected Agent API base URL input');
        }
        input.value = 'http://localhost:17878';
        input.dispatchEvent(new FocusEvent('blur'));

        expect(input.value).toBe('http://127.0.0.1:17878');
    });

    it('keeps revoked profiles visible with only delete available', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                profiles: [
                    {
                        id: 'agent-1',
                        name: 'Trusted Local',
                        scopes: ['observe', 'operate'] as AgentScope[],
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
        expect(row.textContent).toContain('Delete');
        const buttons = Array.from(row.querySelectorAll('button')).map((button) =>
            button.textContent.trim(),
        );
        expect(buttons).toEqual(['Delete']);
    });

    it('generates a replacement token and shows a copy token action', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                profiles: [
                    {
                        id: 'agent-1',
                        name: 'Trusted Local',
                        scopes: ['observe'] as AgentScope[],
                        tokenPrefix: 'axl_agent_replace',
                        createdAt: '2026-05-22T00:00:00Z',
                        lastSeenAt: null,
                        revoked: false,
                    },
                ],
            }),
        );
        service.rotateAgentProfile = vi.fn().mockImplementation((id: string) =>
            Promise.resolve({
                profile: {
                    id,
                    name: 'Trusted Local',
                    scopes: ['observe'] as AgentScope[],
                    tokenPrefix: 'axl_agent_new',
                    createdAt: '2026-05-22T00:00:00Z',
                    lastSeenAt: null,
                    revoked: false,
                },
            }),
        );
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
        );

        renderer.init(context);
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain('Generate new token');
        });

        const rotateButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'Generate new token');
        rotateButton?.click();

        await vi.waitFor(() => {
            expect(service.rotateAgentProfile).toHaveBeenCalledWith('agent-1');
        });
        await vi.waitFor(() => {
            expect(copyTokenButton()).not.toBeUndefined();
        });
        const copyButton = copyTokenButton();
        expect(copyButton?.textContent).toBe('📋');
        copyButton?.click();
        await vi.waitFor(() => {
            expect(service.copyAgentProfileToken).toHaveBeenCalledWith('agent-1');
        });
        expect(context.showToast).toHaveBeenCalledWith('Token created', 'success');
    });

    it('deletes profiles after confirmation', async () => {
        service.getAgentControlState = vi.fn().mockResolvedValue(
            state({
                profiles: [
                    {
                        id: 'agent-1',
                        name: 'Trusted Local',
                        scopes: ['observe'] as AgentScope[],
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
