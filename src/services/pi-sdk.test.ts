import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiSdkAdapter } from './pi-sdk';
import { PiRpcClient } from '../sdk/piTypes';

function createMockClient(): PiRpcClient {
    return {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn(() => vi.fn()),
        prompt: vi.fn().mockResolvedValue('handled'),
        abort: vi.fn().mockResolvedValue(undefined),
        newSession: vi.fn().mockResolvedValue({ cancelled: false }),
        switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
        setSessionName: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockResolvedValue({ sessionId: 'test' }),
        getMessages: vi.fn().mockResolvedValue([]),
        getAvailableModels: vi.fn().mockResolvedValue([]),
        setModel: vi.fn().mockResolvedValue({ provider: 'anthropic', id: 'claude-3' }),
        getStderr: vi.fn().mockReturnValue(''),
    } as unknown as PiRpcClient;
}

describe('PiSdkAdapter', () => {
    let mockClient: PiRpcClient;
    let adapter: PiSdkAdapter;

    beforeEach(() => {
        mockClient = createMockClient();
        adapter = new PiSdkAdapter(mockClient);
    });

    describe('lifecycle', () => {
        it('should delegate start', async () => {
            await adapter.start();

            expect(mockClient.start).toHaveBeenCalled();
        });

        it('should delegate stop', async () => {
            await adapter.stop();

            expect(mockClient.stop).toHaveBeenCalled();
        });
    });

    describe('prompt', () => {
        it('should delegate prompt', async () => {
            const result = await adapter.prompt('test message');

            expect(mockClient.prompt).toHaveBeenCalledWith('test message');
            expect(result).toBe('handled');
        });
    });

    describe('abort', () => {
        it('should delegate abort', async () => {
            await adapter.abort();

            expect(mockClient.abort).toHaveBeenCalled();
        });
    });

    describe('events', () => {
        it('should delegate onEvent', () => {
            const listener = vi.fn();
            const unsubscribe = adapter.onEvent(listener);

            expect(mockClient.onEvent).toHaveBeenCalled();
            expect(typeof unsubscribe).toBe('function');
        });
    });

    describe('session', () => {
        it('should delegate newSession', async () => {
            const result = await adapter.newSession();

            expect(mockClient.newSession).toHaveBeenCalled();
            expect(result).toEqual({ cancelled: false });
        });

        it('should delegate newSession with parent', async () => {
            await adapter.newSession('parent-id');

            expect(mockClient.newSession).toHaveBeenCalledWith('parent-id');
        });

        it('should delegate switchSession', async () => {
            const result = await adapter.switchSession('/path/to/session.jsonl');

            expect(mockClient.switchSession).toHaveBeenCalledWith('/path/to/session.jsonl');
            expect(result).toEqual({ cancelled: false });
        });

        it('should delegate setSessionName', async () => {
            await adapter.setSessionName('New Name');

            expect(mockClient.setSessionName).toHaveBeenCalledWith('New Name');
        });
    });

    describe('state', () => {
        it('should delegate getState', async () => {
            const result = await adapter.getState();

            expect(mockClient.getState).toHaveBeenCalled();
            expect(result).toEqual({ sessionId: 'test' });
        });

        it('should delegate getMessages', async () => {
            const result = await adapter.getMessages();

            expect(mockClient.getMessages).toHaveBeenCalled();
            expect(result).toEqual([]);
        });
    });

    describe('models', () => {
        it('should delegate getAvailableModels', async () => {
            const result = await adapter.getAvailableModels();

            expect(mockClient.getAvailableModels).toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('should delegate setModel', async () => {
            const result = await adapter.setModel('anthropic', 'claude-3');

            expect(mockClient.setModel).toHaveBeenCalledWith('anthropic', 'claude-3');
            expect(result).toEqual({ provider: 'anthropic', id: 'claude-3' });
        });
    });

    describe('optional methods', () => {
        it('should throw for unsupported getSessionStats', async () => {
            await expect(adapter.getSessionStats?.()).rejects.toThrow('getSessionStats not supported');
        });

        it('should return empty array for unsupported getAvailableThinkingLevels', async () => {
            const result = await adapter.getAvailableThinkingLevels?.();

            expect(result).toEqual([]);
        });

        it('should not throw for unsupported setThinkingLevel', async () => {
            await expect(adapter.setThinkingLevel?.('high')).resolves.toBeUndefined();
        });
    });

    describe('getStderr', () => {
        it('should delegate getStderr', () => {
            (mockClient.getStderr as any).mockReturnValue('error output');

            const result = adapter.getStderr();

            expect(result).toBe('error output');
        });
    });
});
