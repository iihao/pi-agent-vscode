import { describe, it, expect, beforeEach } from 'vitest';
import {
    selectBusy,
    selectContexts,
    selectContextsCount,
    selectConnected,
    selectCurrentModel,
    selectCurrentSession,
    selectCurrentSessionId,
    selectCurrentThinking,
    selectHasContexts,
    selectIsReady,
    selectLastUsage,
    selectModelCount,
    selectModels,
    selectPermissionMode,
    selectSessionCount,
    selectSessions,
    selectStats,
    selectThinkingLevels,
    selectTurnHadText,
} from './selectors';
import { setState, getState } from './store';
import { getInitialState } from './types';

describe('StateSelectors', () => {
    beforeEach(() => {
        setState(getInitialState());
    });

    it('should select busy state', () => {
        expect(selectBusy(getState())).toBe(false);
        setState({ busy: true });
        expect(selectBusy(getState())).toBe(true);
    });

    it('should select contexts', () => {
        const contexts = [
            { id: '1', type: 'file' as const, path: '/test.ts' },
        ];
        setState({ contexts });
        expect(selectContexts(getState())).toEqual(contexts);
    });

    it('should select contexts count', () => {
        expect(selectContextsCount(getState())).toBe(0);
        setState({
            contexts: [
                { id: '1', type: 'file', path: '/test.ts' },
                { id: '2', type: 'selection', path: '/test.ts', lineRange: '1-5' },
            ],
        });
        expect(selectContextsCount(getState())).toBe(2);
    });

    it('should select connected state', () => {
        expect(selectConnected(getState())).toBe(false);
        setState({ connected: true });
        expect(selectConnected(getState())).toBe(true);
    });

    it('should select current model', () => {
        const model = { provider: 'anthropic', id: 'claude-3' };
        setState({ currentModel: model });
        expect(selectCurrentModel(getState())).toEqual(model);
    });

    it('should select current session', () => {
        const sessions = [
            { id: '1', file: '/session1.jsonl', createdAt: 1000, messageCount: 5 },
            { id: '2', file: '/session2.jsonl', createdAt: 2000, messageCount: 10 },
        ];
        setState({ sessions, currentSessionId: '2' });
        expect(selectCurrentSession(getState())).toEqual(sessions[1]);
    });

    it('should select current session id', () => {
        setState({ currentSessionId: 'test-id' });
        expect(selectCurrentSessionId(getState())).toBe('test-id');
    });

    it('should select current thinking', () => {
        setState({ currentThinking: 'high' });
        expect(selectCurrentThinking(getState())).toBe('high');
    });

    it('should select has contexts', () => {
        expect(selectHasContexts(getState())).toBe(false);
        setState({
            contexts: [{ id: '1', type: 'file', path: '/test.ts' }],
        });
        expect(selectHasContexts(getState())).toBe(true);
    });

    it('should select is ready', () => {
        expect(selectIsReady(getState())).toBe(false);
        setState({ connected: true, busy: false, connecting: false });
        expect(selectIsReady(getState())).toBe(true);
    });

    it('should select last usage', () => {
        const usage = { input: 100, output: 50, cacheRead: 200 };
        setState({ lastUsage: usage });
        expect(selectLastUsage(getState())).toEqual(usage);
    });

    it('should select model count', () => {
        expect(selectModelCount(getState())).toBe(0);
        setState({
            models: [
                { provider: 'anthropic', id: 'claude-3' },
                { provider: 'openai', id: 'gpt-4' },
            ],
        });
        expect(selectModelCount(getState())).toBe(2);
    });

    it('should select models', () => {
        const models = [
            { provider: 'anthropic', id: 'claude-3' },
            { provider: 'openai', id: 'gpt-4' },
        ];
        setState({ models });
        expect(selectModels(getState())).toEqual(models);
    });

    it('should select permission mode', () => {
        expect(selectPermissionMode(getState())).toBe('ask');
        setState({ permissionMode: 'autoConfirm' });
        expect(selectPermissionMode(getState())).toBe('autoConfirm');
    });

    it('should select session count', () => {
        expect(selectSessionCount(getState())).toBe(0);
        setState({
            sessions: [
                { id: '1', file: '/session1.jsonl', createdAt: 1000, messageCount: 5 },
            ],
        });
        expect(selectSessionCount(getState())).toBe(1);
    });

    it('should select sessions', () => {
        const sessions = [
            { id: '1', file: '/session1.jsonl', createdAt: 1000, messageCount: 5 },
        ];
        setState({ sessions });
        expect(selectSessions(getState())).toEqual(sessions);
    });

    it('should select stats', () => {
        const stats = {
            input: 1000,
            output: 500,
            cacheRead: 2000,
            cacheWrite: 100,
            contextPercent: 25.5,
            contextWindow: 200000,
            autoCompact: true,
        };
        setState({ stats });
        expect(selectStats(getState())).toEqual(stats);
    });

    it('should select thinking levels', () => {
        const levels = ['low', 'medium', 'high'];
        setState({ thinkingLevels: levels });
        expect(selectThinkingLevels(getState())).toEqual(levels);
    });

    it('should select turn had text', () => {
        expect(selectTurnHadText(getState())).toBe(false);
        setState({ turnHadText: true });
        expect(selectTurnHadText(getState())).toBe(true);
    });
});
