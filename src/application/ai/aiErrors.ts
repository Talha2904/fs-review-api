import { AiGatewayError } from '../ports/AiGateway.js';

/** Anthropic's errors in plain language. The details stay in the server log. */
export function plainAiError(e: unknown): string {
  const st = e instanceof AiGatewayError ? e.status : undefined;
  const msg = e instanceof Error ? e.message : String(e);
  if (st === 401 || st === 403)
    return 'The Claude API key on the server was rejected. An Administrator should check the key (AI Settings › Test Connection).';
  if (st === 429) return 'Claude is receiving too many requests from this account right now. Wait a minute and try again.';
  if (st === 529 || st === 503) return 'Claude is temporarily overloaded. Try again in a few minutes.';
  if (st === 400 && /model/i.test(msg))
    return 'The chosen Claude model is not available to this API key. An Administrator can choose another under AI Settings.';
  return msg || 'The AI request failed.';
}
