// ---------------------------------------------------------------------------
// Built-in provider table (ids and env var names taken from pi's provider defs)
//
// Only used for the picker and hints in the "connect a provider" flow; the real
// credential check is `pi auth check --provider <id>`. Users can also pick
// "Other" and type an id.
// ---------------------------------------------------------------------------

export interface ProviderInfo {
    /** pi provider id (used by auth.json / models.json / --provider) */
    id: string;
    /** Display name */
    label: string;
    /** Environment variable holding this provider's API key */
    envVar: string;
}

export const KNOWN_PROVIDERS: ProviderInfo[] = [
    { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
    { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
    { id: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
    { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
    { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
    { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
    { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
    { id: 'xai', label: 'xAI (Grok)', envVar: 'XAI_API_KEY' },
    { id: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
    { id: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY' },
    { id: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY' },
    { id: 'moonshotai', label: 'Moonshot AI (Kimi)', envVar: 'MOONSHOT_API_KEY' },
    { id: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY' },
    { id: 'zai', label: 'ZAI', envVar: 'ZAI_API_KEY' },
    { id: 'opencode', label: 'OpenCode Zen / Go', envVar: 'OPENCODE_API_KEY' },
    { id: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY' },
    { id: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN' },
    { id: 'baseten', label: 'Baseten', envVar: 'BASETEN_API_KEY' },
    { id: 'nvidia', label: 'NVIDIA NIM', envVar: 'NVIDIA_API_KEY' },
    { id: 'meta', label: 'Meta', envVar: 'META_API_KEY' },
    { id: 'xiaomi', label: 'Xiaomi MiMo', envVar: 'XIAOMI_API_KEY' },
    { id: 'azure', label: 'Azure OpenAI', envVar: 'AZURE_OPENAI_API_KEY' },
    { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'AI_GATEWAY_API_KEY' },
    { id: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', envVar: 'CLOUDFLARE_API_KEY' },
    { id: 'google-vertex', label: 'Google Vertex AI', envVar: 'GOOGLE_CLOUD_API_KEY' },
];

export function providerInfo(id: string | undefined): ProviderInfo | undefined {
    if (!id) { return undefined; }
    return KNOWN_PROVIDERS.find((p) => p.id === id);
}

export function providerLabel(id: string | undefined): string {
    if (!id) { return ''; }
    return providerInfo(id)?.label ?? id;
}
