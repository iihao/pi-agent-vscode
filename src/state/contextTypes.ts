// ---------------------------------------------------------------------------
// 上下文和会话类型定义（独立文件，避免循环依赖）
// ---------------------------------------------------------------------------

export interface ContextItem {
    id: string;
    type: 'file' | 'selection';
    path: string;
    languageId?: string;
    code?: string;
    lineRange?: string;
}

export interface SessionInfo {
    id: string;
    file: string;
    createdAt: number;
    messageCount: number;
    name?: string;
}
