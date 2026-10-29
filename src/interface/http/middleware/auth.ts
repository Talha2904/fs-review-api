import type { NextFunction, Request, Response } from 'express';

import type { Permission, PermissionMatrix } from '@fs-review/shared';
import { can } from '@fs-review/shared';

import type { ResolveSession } from '../../../application/identity/ResolveSession.js';
import type { PermissionRepository } from '../../../application/ports/PermissionRepository.js';
import { forbidden, unauthenticated } from '../../../domain/errors.js';
import type { Actor } from '../../../domain/identity/User.js';
import { readSessionCookie } from '../cookies.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor: Actor | null;
    matrix: PermissionMatrix;
    sessionToken: string | undefined;
  }
}

/** Resolves the session cookie to an actor and loads the current matrix, on every request. */
export function attachActor(resolve: ResolveSession, permissions: PermissionRepository) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.sessionToken = readSessionCookie(req);
      req.actor = await resolve.execute(req.sessionToken);
      req.matrix = await permissions.get();
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Rejects the request unless a signed-in, active user holds the permission under the saved matrix. */
export const requirePerm =
  (perm: Permission) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) return next(unauthenticated());
    if (!can(req.actor, perm, req.matrix)) return next(forbidden(`The ${req.actor.role} role cannot do this.`));
    next();
  };

/** Clients behind a proxy report the real address through trust proxy; otherwise the socket's. */
export const ipOf = (req: Request): string => req.ip ?? '';
