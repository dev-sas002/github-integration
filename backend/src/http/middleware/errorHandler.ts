import { NextFunction, Request, Response } from 'express';
import { ProviderError } from '../../domain/provider';
import { HttpError } from '../../lib/httpError';
import logger from '../../lib/logger';

/** Maps a provider failure onto the status the API should answer with. */
const fromProviderError = (error: ProviderError): HttpError => {
  if (error.rateLimited) {
    return new HttpError(429, 'GitHub API rate limit exceeded, try again later', {
      headers: error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {},
    });
  }

  return new HttpError(502, 'Upstream provider request failed');
};

/**
 * The single place an error becomes a response.
 *
 * Controllers throw; nothing in them formats an error body. Unexpected errors
 * are logged in full and answered with a generic 500 — internal messages are
 * never echoed to a client.
 */
export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const httpError =
    error instanceof HttpError
      ? error
      : error instanceof ProviderError
        ? fromProviderError(error)
        : null;

  if (!httpError) {
    logger.error('unhandled error', { message: (error as Error)?.message });
    res.status(500).json({ message: 'Internal server error' });
    return;
  }

  for (const [name, value] of Object.entries(httpError.headers)) {
    res.set(name, value);
  }

  if (httpError.status >= 500) {
    logger.error('request failed', { status: httpError.status, message: httpError.message });
  }

  const extra = httpError.details && typeof httpError.details === 'object' ? httpError.details : {};

  res.status(httpError.status).json({ message: httpError.message, ...extra });
};

/** 404 for anything the routers did not claim. */
export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ message: 'Not found' });
};
