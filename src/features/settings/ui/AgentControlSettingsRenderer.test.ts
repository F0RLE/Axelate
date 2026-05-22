import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        | 'revokeAgentProfile'
        | 'decideAgentApproval'
    >;
    let copyText: (text: string) => Promise<void>;
    let context: IAppSettingsUIContext;

    beforeEach(() => {
        document.body.innerHTML = '<div id="agent-control-panel"></div>';
        const copyTextMock = vi.fn().mockResolvedValue(undefined);
        copyText = async (text: string) => {
            await copyTextMock(text);
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
                token: 'axl_agent_abc_secret',
            }),
            rotateAgentProfile: vi.fn(),
            revokeAgentProfile: vi.fn(),
            decideAgentApproval: vi.fn(),
        };
        context = {
            t: (_key: string, fallback = '') => fallback,
            showToast: vi.fn(),
            toggleNavItem: vi.fn(),
            toggleMonitorItem: vi.fn(),
            i18nUI: { applyTranslations: vi.fn() },
        } as unknown as IAppSettingsUIContext;
    });

    it('creates a Trusted Local profile and renders the one-time token', async () => {
        const renderer = new AgentControlSettingsRenderer(
            service as SettingsService,
            { error: vi.fn(), warn: vi.fn() } as unknown as LoggerService,
            { copyText },
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
            expect(document.body.textContent).toContain('axl_agent_abc_secret');
        });
        expect(service.createAgentProfile).toHaveBeenCalledWith('Trusted Local', [
            'observe',
            'operate',
            'configure',
            'draft-create',
        ]);
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
            { copyText },
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
            { copyText },
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
        const buttons = Array.from(row.querySelectorAll('button')).map((button) =>
            button.textContent.trim(),
        );
        expect(buttons).toEqual(['Rotate']);
    });
});
