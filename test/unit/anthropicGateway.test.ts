import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { plainAiError } from '../../src/application/ai/aiErrors.js';
import { AiGatewayError } from '../../src/application/ports/AiGateway.js';
import { AnthropicGateway, wrap } from '../../src/infrastructure/ai/AnthropicGateway.js';

// Answers are streamed, so an error can arrive after the response has started: then it has an API error type but
// no HTTP status, or (a dropped connection) neither. Each must still reach the user in plain words.
const midStream = (type: string, message: string) =>
  new Anthropic.APIError(undefined, { type: 'error', error: { type, message } }, undefined, new Headers());

describe('Claude errors in plain language', () => {
  it('an overload, rate limit or server error inside a streamed answer reads like the same error before it', () => {
    expect(plainAiError(wrap(midStream('overloaded_error', 'Overloaded')))).toBe(
      'Claude is temporarily overloaded. Try again in a few minutes.'
    );
    expect(plainAiError(wrap(midStream('rate_limit_error', 'Too many')))).toMatch(/too many requests/);
    expect(plainAiError(wrap(midStream('api_error', 'Internal')))).toBe(
      'Claude had a problem while answering. Try again in a few minutes.'
    );
  });

  it('errors before the answer starts keep their HTTP status', () => {
    const e = new Anthropic.APIError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      undefined,
      new Headers()
    );
    expect(wrap(e).status).toBe(529);
    expect(wrap(new Anthropic.APIError(401, {}, 'invalid x-api-key', new Headers())).status).toBe(401);
  });

  it('a dropped connection says so, not the transport’s own wording', () => {
    expect(plainAiError(wrap(new Anthropic.AnthropicError('terminated')))).toBe(
      'The connection to Claude was interrupted before it finished answering. Try again.'
    );
    expect(plainAiError(wrap(new Anthropic.APIConnectionError({ message: 'Connection error.' })))).toMatch(/interrupted/);
  });

  it('the app’s own errors pass through unchanged, and an unknown error keeps its message', () => {
    const own = new AiGatewayError('Claude ran out of room before answering.');
    expect(wrap(own)).toBe(own);
    expect(plainAiError(wrap(new Error('something else')))).toBe('something else');
  });

  it('with no key there is no client, and the gateway says so', async () => {
    const g = new AnthropicGateway(undefined);
    expect(g.keyStatus()).toEqual({ configured: false, last4: '' });
    await expect(
      g.structured({
        model: 'claude-sonnet-5-5',
        system: '',
        content: [],
        tool: { name: 't', description: '', input_schema: {} },
        maxTokens: 10
      })
    ).rejects.toMatchObject({ status: 503 });
  });
});
