// Domain and application errors. One shape for every failure the api reports:
// { error: { code, message, details? } }. The HTTP layer maps `code` to a status.
// Use cases throw these; they never know about HTTP.

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'LOCKED'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  toBody(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } };
  }
}

export const validationFailed = (message: string, details?: unknown): AppError => new AppError('VALIDATION_FAILED', message, details);
export const unauthenticated = (message = 'Your session has ended. Sign in again.'): AppError => new AppError('UNAUTHENTICATED', message);
export const forbidden = (message: string): AppError => new AppError('FORBIDDEN', message);
export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} was not found.`);
export const conflict = (message: string): AppError => new AppError('CONFLICT', message);
export const locked = (message = 'This review is signed off and locked. Unlock it to make changes.'): AppError =>
  new AppError('LOCKED', message);
export const aiUnavailable = (message: string): AppError => new AppError('AI_UNAVAILABLE', message);
