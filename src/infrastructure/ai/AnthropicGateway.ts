import Anthropic from '@anthropic-ai/sdk';

import { AiGatewayError, type AiGateway, type StructuredCall, type StructuredResult } from '../../application/ports/AiGateway.js';

/** The only place the Anthropic SDK and the API key are used. */
export class AnthropicGateway implements AiGateway {
  private readonly client: Anthropic | null;

  constructor(private readonly apiKey: string | undefined) {
    this.client = apiKey && apiKey.length > 10 ? new Anthropic({ apiKey }) : null;
  }

  keyStatus(): { configured: boolean; last4: string } {
    const k = this.apiKey ?? '';
    return { configured: k.length > 10, last4: k.length > 10 ? k.slice(-4) : '' };
  }

  async structured<T = unknown>(call: StructuredCall): Promise<StructuredResult<T>> {
    const client = this.require();
    try {
      const res = await client.messages.create({
        model: call.model,
        max_tokens: call.maxTokens,
        temperature: 0,
        system: call.system,
        tools: [
          {
            name: call.tool.name,
            description: call.tool.description,
            input_schema: call.tool.input_schema as Anthropic.Tool['input_schema']
          }
        ],
        tool_choice: { type: 'tool', name: call.tool.name },
        messages: [{ role: 'user', content: call.content as Anthropic.ContentBlockParam[] }]
      });
      const out = res.content.find((b) => b.type === 'tool_use');
      if (!out || out.type !== 'tool_use') throw new AiGatewayError('Claude returned no structured output');
      return {
        output: out.input as T,
        model: res.model,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0
      };
    } catch (e) {
      throw wrap(e);
    }
  }

  async ping(model: string): Promise<{ model: string; ms: number }> {
    const client = this.require();
    const t0 = Date.now();
    try {
      const r = await client.messages.create({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK.' }] });
      return { model: r.model, ms: Date.now() - t0 };
    } catch (e) {
      throw wrap(e);
    }
  }

  private require(): Anthropic {
    if (!this.client) throw new AiGatewayError('No Claude API key is configured on the server.', 503);
    return this.client;
  }
}

function wrap(e: unknown): AiGatewayError {
  if (e instanceof AiGatewayError) return e;
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined;
  const message = e instanceof Error ? e.message : String(e);
  return new AiGatewayError(message, status);
}
