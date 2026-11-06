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
      // Current models reject `temperature` and a forced tool_choice ('tool' / 'any'), so the tool is offered
      // with 'auto' and the system prompt asks for exactly one call to it. This works on every Claude model.
      // Streamed, so a long answer is not cut short: current models think before answering and that thinking
      // counts towards max_tokens, and a request that is not streamed must stay small to avoid HTTP timeouts.
      // finalMessage() returns the complete message, exactly as a non-streamed call would.
      const res = await client.messages
        .stream({
          model: call.model,
          max_tokens: call.maxTokens,
          system: `${call.system}\n\nAnswer only by calling the ${call.tool.name} tool, exactly once.`,
          tools: [
            {
              name: call.tool.name,
              description: call.tool.description,
              input_schema: call.tool.input_schema as Anthropic.Tool['input_schema']
            }
          ],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          messages: [{ role: 'user', content: call.content as Anthropic.ContentBlockParam[] }]
        })
        .finalMessage();
      // an answer cut off at the token limit may hold a partial tool call: never use it as if complete
      if (res.stop_reason === 'max_tokens')
        throw new AiGatewayError('Claude ran out of room before answering. Try again, or analyse fewer or smaller documents.');
      const out = res.content.find((b) => b.type === 'tool_use' && b.name === call.tool.name);
      if (!out || out.type !== 'tool_use')
        throw new AiGatewayError(res.stop_reason === 'refusal' ? 'Claude declined this request.' : 'Claude returned no structured output');
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

/** The HTTP status each API error type stands for, for an error that arrives inside a streamed answer (it has a type, no status). */
const TYPE_STATUS: Record<string, number> = {
  overloaded_error: 529,
  rate_limit_error: 429,
  api_error: 500,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404
};

/** Turns an SDK error into the gateway's own, with the status plainAiError reads. Exported for its tests. */
export function wrap(e: unknown): AiGatewayError {
  if (e instanceof AiGatewayError) return e;
  const err = e as { status?: unknown; type?: unknown; error?: { error?: { type?: unknown } } };
  const type = typeof err?.type === 'string' ? err.type : typeof err?.error?.error?.type === 'string' ? err.error.error.type : undefined;
  const status = typeof err?.status === 'number' ? err.status : type ? TYPE_STATUS[type] : undefined;
  // An SDK error with neither a status nor an API error type: the connection broke (a dropped stream, a
  // network or proxy failure, a timeout), so say that rather than show the transport's own wording.
  if (status === undefined && !type && e instanceof Anthropic.AnthropicError)
    return new AiGatewayError('The connection to Claude was interrupted before it finished answering. Try again.');
  return new AiGatewayError(e instanceof Error ? e.message : String(e), status);
}
