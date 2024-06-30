import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Anthropic SDK is replaced with a double, so these cases assert the
 * request shape and the degradation rules without any possibility of a paid
 * call. `appConfig` is mocked too, because `aiEnabled` is derived at import
 * time and both sides of that switch need covering.
 */
const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const constructed: any[] = [];

  class FakeAnthropic {
    messages = { create };

    constructor(options: any) {
      constructed.push(options);
    }
  }

  const config = {
    anthropicApiKey: 'test-key',
    anthropicModel: 'claude-opus-5',
    anthropicBaseUrl: 'https://api.anthropic.com',
    anthropicTimeoutMs: 20000,
    aiEnabled: true,
    logLevel: 'error',
  };

  return { create, constructed, FakeAnthropic, config };
});

vi.mock('@anthropic-ai/sdk', () => ({ default: mocks.FakeAnthropic }));
vi.mock('../../../src/config/appConfig', () => ({ default: mocks.config }));

import llmClient from '../../../src/services/ai/llmClient';

const request = {
  system: 'system prompt',
  prompt: '{"fullName":"octo-labs/x"}',
  schema: { type: 'object', properties: { headline: { type: 'string' } } },
};

const textResponse = (body: unknown) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(body) }],
});

beforeEach(() => {
  mocks.config.aiEnabled = true;
  mocks.create.mockReset();
});

describe('llmClient', () => {
  it('reports itself disabled when no key is configured', async () => {
    mocks.config.aiEnabled = false;

    expect(llmClient.isEnabled()).toBe(false);
    expect(await llmClient.complete(request)).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns the parsed structured output', async () => {
    mocks.create.mockResolvedValue(textResponse({ headline: 'Steady' }));

    const result = await llmClient.complete<{ headline: string }>(request);

    expect(result).toEqual({ headline: 'Steady' });
  });

  it('asks for a json_schema response rather than parsing prose', async () => {
    mocks.create.mockResolvedValue(textResponse({ headline: 'x' }));

    await llmClient.complete(request);

    const [args] = mocks.create.mock.calls[0];
    expect(args.model).toBe('claude-opus-5');
    expect(args.system).toBe('system prompt');
    expect(args.output_config.format).toEqual({
      type: 'json_schema',
      schema: request.schema,
    });
    expect(args.output_config.effort).toBe('low');
  });

  it('leaves room for the response under max_tokens', async () => {
    mocks.create.mockResolvedValue(textResponse({ headline: 'x' }));

    await llmClient.complete(request);

    expect(mocks.create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('returns null when the model declines the request', async () => {
    mocks.create.mockResolvedValue({ stop_reason: 'refusal', content: [] });

    expect(await llmClient.complete(request)).toBeNull();
  });

  it('returns null rather than throwing when the call fails', async () => {
    mocks.create.mockRejectedValue(new Error('upstream exploded'));

    expect(await llmClient.complete(request)).toBeNull();
  });

  it('returns null when the response carries no text block', async () => {
    mocks.create.mockResolvedValue({ stop_reason: 'end_turn', content: [] });

    expect(await llmClient.complete(request)).toBeNull();
  });

  it('ignores thinking blocks and reads only the text', async () => {
    mocks.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"headline":"From text"}' },
      ],
    });

    expect(await llmClient.complete<{ headline: string }>(request)).toEqual({
      headline: 'From text',
    });
  });

  it('returns null on malformed JSON instead of propagating a parse error', async () => {
    mocks.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }],
    });

    expect(await llmClient.complete(request)).toBeNull();
  });
});
