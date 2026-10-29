import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { ipOf, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { CreateUserBody, PermissionsBody, UpdateUserBody, UserIdParams } from '../schemas/identity.js';

export function userRoutes(uc: UseCases): Router {
  const r = Router();

  r.get('/users', requirePerm('users.manage'), async (req, res, next) => {
    try {
      res.json({ users: await uc.listUsers.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/users', requirePerm('users.manage'), validate({ body: CreateUserBody }), async (req, res, next) => {
    try {
      res.json({ user: await uc.createUser.execute(req.actor, req.matrix, req.body, ipOf(req)) });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/users/:id', requirePerm('users.manage'), validate({ params: UserIdParams, body: UpdateUserBody }), async (req, res, next) => {
    try {
      res.json({ user: await uc.updateUser.execute(req.actor, req.matrix, String(req.params.id), req.body, ipOf(req), req.sessionToken) });
    } catch (e) {
      next(e);
    }
  });

  // Staff directory for choosing preparers, reviewers, managers and partners: names and roles only.
  r.get('/people', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json({ people: await uc.listPeople.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });

  // Anyone may read the matrix (the sign-in page shows it); only Administrators change it.
  r.get('/permissions', async (_req, res, next) => {
    try {
      res.json({ matrix: await uc.getPermissions.execute() });
    } catch (e) {
      next(e);
    }
  });

  r.put('/permissions', requirePerm('users.manage'), validate({ body: PermissionsBody }), async (req, res, next) => {
    try {
      res.json({ matrix: await uc.savePermissions.execute(req.actor, req.matrix, req.body.matrix, ipOf(req)) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
