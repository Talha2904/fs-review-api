/**
 * The Claude API behind a port. Every call uses forced tool use, so the answer is JSON matching
 * the tool's input schema. The adapter owns the API key; nothing else sees it.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StructuredCall {
  model: string;
  system: string;
  content: ContentBlock[];
  tool: ToolSpec;
  maxTokens: number;
}

export interface StructuredResult<T = unknown> {
  output: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Thrown by adapters for upstream failures. `status` is the upstream HTTP status when known. */
export class AiGatewayError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiGatewayError';
    this.status = status;
  }
}

export interface AiGateway {
  /** Whether an API key is configured, and its last four characters for the settings screen. */
  keyStatus(): { configured: boolean; last4: string };
  structured<T = unknown>(call: StructuredCall): Promise<StructuredResult<T>>;
  /** One tiny call to prove the key and model work. Returns the model that answered and the time taken. */
  ping(model: string): Promise<{ model: string; ms: number }>;
}
