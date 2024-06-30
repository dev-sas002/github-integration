import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../../lib/httpError';
import UserModel from '../../models/user';

export interface AuthenticatedUser {
  id: string;
  username: string;
  /** The stored header value, `Bearer <token>`, as provided to the provider. */
  token: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

/**
 * `decodeURIComponent` throws on malformed input (a stray `%`), which would
 * otherwise turn a bad header into an unhandled 500.
 */
export const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export interface AuthenticateOptions {
  /** Body/status used when the header is absent. */
  missingMessage?: string;
  /** Status used when the token matches no user (404 on the removal route). */
  invalidStatus?: number;
  invalidMessage?: string;
  /** Extra fields merged into the error body, e.g. `{ isConnected: false }`. */
  extra?: Record<string, unknown>;
}

/**
 * Resolves the bearer token to a user and hangs it off the request.
 *
 * Doing this once, here, is what let every controller below drop its own copy
 * of "read the header, decode it, look the user up, decide which error to
 * send" — four near-identical blocks before this refactor.
 */
export const authenticate =
  (options: AuthenticateOptions = {}) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Express 5 forwards a rejected promise to the error handler, so the
    // HttpErrors below need no try/catch around them.
    const { authorization } = req.headers;

    if (!authorization) {
      throw new HttpError(401, options.missingMessage ?? 'Missing Authorization header', {
        details: options.extra,
      });
    }

    const token = safeDecode(authorization);
    const user = await UserModel.findOne({ accessToken: token });

    if (!user) {
      throw new HttpError(
        options.invalidStatus ?? 401,
        options.invalidMessage ?? 'Invalid access token',
        { details: options.extra },
      );
    }

    req.auth = {
      id: String(user._id),
      username: String(user.username ?? ''),
      token,
    };

    next();
  };
