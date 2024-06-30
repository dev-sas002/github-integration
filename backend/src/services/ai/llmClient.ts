import Anthropic from '@anthropic-ai/sdk';
import appConfig from '../../config/appConfig';
import logger from '../../lib/logger';

export interface NarrativeRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmClient {
  isEnabled(): boolean;
  /** Returns the parsed model output, or `null` when unavailable for any reason. */
  complete<T>(request: NarrativeRequest): Promise<T | null>;
}

let cachedClient: Anthropic | null = null;

const anthropic = (): Anthropic => {
  if (!cachedClient) {
    // Constructed lazily so importing this module never requires a key.
    cachedClient = new Anthropic({
      apiKey: appConfig.anthropicApiKey,
      baseURL: appConfig.anthropicBaseUrl,
      timeout: appConfig.anthropicTimeoutMs,
      maxRetries: 2,
    });
  }
  return cachedClient;
};

/**
 * Wrapper around the Anthropic Messages API for the insights features.
 *
 * Two rules hold everywhere it is used:
 *  - with no `ANTHROPIC_API_KEY` the client reports itself disabled and every
 *    caller falls back to a deterministic, locally computed narrative;
 *  - a model failure is never fatal — it logs and returns `null`, so a flaky
 *    provider degrades the page rather than breaking it.
 *
 * Structured outputs (`output_config.format`) are used instead of parsing prose,
 * so the response shape is guaranteed rather than hoped for.
 */
export const llmClient: LlmClient = {
  isEnabled: () => appConfig.aiEnabled,

  async complete<T>(request: NarrativeRequest): Promise<T | null> {
    if (!appConfig.aiEnabled) {
      return null;
    }

    try {
      const response = await anthropic().messages.create({
        model: appConfig.anthropicModel,
        max_tokens: request.maxTokens ?? 16000,
        system: request.system,
        // Summarising a few hundred tokens of repository metadata is not a
        // reasoning-heavy task; low effort keeps latency and cost down.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: request.schema },
        },
        messages: [{ role: 'user', content: request.prompt }],
      });

      if (response.stop_reason === 'refusal') {
        logger.warn('model declined the insight request');
        return null;
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return text ? (JSON.parse(text) as T) : null;
    } catch (error) {
      logger.warn('insight generation failed, falling back to heuristics', {
        message: (error as Error).message,
      });
      return null;
    }
  },
};

export default llmClient;
