/**
 * An error carrying the HTTP status the API should answer with.
 *
 * Services throw these; the single error-handling middleware turns them into
 * responses. That keeps status-code decisions next to the business rule that
 * produced them instead of scattered through controllers.
 */
export class HttpError extends Error {
  readonly status: number;

  readonly headers: Record<string, string>;

  readonly details?: unknown;

  constructor(
    status: number,
    message: string,
    options: { headers?: Record<string, string>; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = options.headers ?? {};
    this.details = options.details;
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, { details });

export const unauthorized = (message: string): HttpError => new HttpError(401, message);

export const notFound = (message: string): HttpError => new HttpError(404, message);

export const rateLimited = (message: string, retryAfterSeconds?: number | null): HttpError =>
  new HttpError(429, message, {
    headers:
      retryAfterSeconds && retryAfterSeconds > 0
        ? { 'Retry-After': String(Math.ceil(retryAfterSeconds)) }
        : {},
  });

export const badGateway = (message: string): HttpError => new HttpError(502, message);

export const serviceUnavailable = (message: string): HttpError => new HttpError(503, message);
