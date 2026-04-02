import type { EmbeddingProvider, LLMProvider } from './types.js';
import { AISdkEmbeddingProvider, AISdkLLMProvider } from './ai-sdk.js';

export interface ProviderConfig {
  provider?: 'openai' | 'anthropic' | 'ollama';
  embeddingModel?: string;
  languageModel?: string;
}

export async function createProviders(config?: ProviderConfig): Promise<{
  embedding: EmbeddingProvider;
  llm: LLMProvider;
}> {
  const provider = config?.provider ?? 'openai';

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({});
      const embModel = openai.embedding(
        config?.embeddingModel ?? 'text-embedding-3-small',
      );
      const langModel = openai(config?.languageModel ?? 'gpt-4o-mini');
      return {
        embedding: new AISdkEmbeddingProvider(embModel, 1536),
        llm: new AISdkLLMProvider(langModel),
      };
    }
    case 'anthropic': {
      // Dynamic imports — these are optional peer dependencies
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anthropicMod = await (import('@ai-sdk/anthropic' as any) as Promise<any>);
      const anthropic = anthropicMod.createAnthropic({});
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({});
      const embModel = openai.embedding(
        config?.embeddingModel ?? 'text-embedding-3-small',
      );
      const langModel = anthropic(
        config?.languageModel ?? 'claude-sonnet-4-5-20250929',
      );
      return {
        embedding: new AISdkEmbeddingProvider(embModel, 1536),
        llm: new AISdkLLMProvider(langModel),
      };
    }
    case 'ollama': {
      // Dynamic imports — these are optional peer dependencies
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ollamaMod = await (import('ollama-ai-provider' as any) as Promise<any>);
      const ollama = ollamaMod.ollama;
      const embModel = ollama.embedding(
        config?.embeddingModel ?? 'nomic-embed-text',
      );
      const langModel = ollama(config?.languageModel ?? 'llama3.2');
      return {
        embedding: new AISdkEmbeddingProvider(embModel, 768),
        llm: new AISdkLLMProvider(langModel),
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
