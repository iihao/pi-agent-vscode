// ---------------------------------------------------------------------------
// Prompt 构建
// ---------------------------------------------------------------------------

import { clipDiff } from './git';

export function buildCommitPrompt(diff: string, branch: string): string {
    return [
        'Write a git commit message for the following changes.',
        'Use Conventional Commits (e.g. "feat: …", "fix: …", "docs: …").',
        'Keep the subject under 72 characters. Output ONLY the commit message.',
        branch ? `Branch: ${branch}` : '',
        '',
        '```diff',
        clipDiff(diff),
        '```',
    ].filter(Boolean).join('\n');
}

export function buildPrPrompt(branch: string, log: string): string {
    return [
        'Write a pull request description in Markdown.',
        'Include a short summary and a bullet list of notable changes.',
        branch ? `Branch: ${branch}` : '',
        '',
        'Commits:',
        log || '(no commits found)',
    ].filter(Boolean).join('\n');
}

export function buildNamePrompt(text: string): string {
    return [
        'Summarize the following user request as a short session title.',
        'Use 3 to 6 words, no quotes, no trailing punctuation. Output only the title.',
        '',
        text.slice(0, 1000),
    ].join('\n');
}
