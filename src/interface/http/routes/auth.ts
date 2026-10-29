import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { clearSessionCookie, setSessionCookie } from '../cookies.js';
import { ipOf } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ForgotBody, LoginBody, ResetBody, SetupBody } from '../schemas/identity.js';

export interface RouteDeps {
  uc: UseCases;
  secureCookies: boolean;
}

export function authRoutes({ uc, secureCookies }: RouteDeps): Router {
  const r = Router();

  r.get('/auth/status', async (_req, res, next) => {
    try {
      res.json(await uc.getAuthStatus.execute());
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/setup', validate({ body: SetupBody }), async (req, res, next) => {
    try {
      const { user, token } = await uc.setupFirstAdmin.execute({ ...req.body, ip: ipOf(req) });
      setSessionCookie(res, token, secureCookies);
      res.json({ user });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/login', validate({ body: LoginBody }), async (req, res, next) => {
    try {
      const { user, token } = await uc.signIn.execute({ ...req.body, ip: ipOf(req) });
      setSessionCookie(res, token, secureCookies);
      res.json({ user });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/logout', async (req, res, next) => {
    try {
      await uc.signOut.execute(req.actor, req.sessionToken, ipOf(req));
      clearSessionCookie(res, secureCookies);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/auth/me', (req, res) => {
    const a = req.actor;
    res.json({ user: a ? { id: a.id, name: a.name, username: a.username, role: a.role, active: a.active } : null });
  });

  r.post('/auth/forgot', validate({ body: ForgotBody }), async (req, res, next) => {
    try {
      res.json(await uc.requestPasswordReset.execute(req.body.login, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/reset', validate({ body: ResetBody }), async (req, res, next) => {
    try {
      await uc.resetPassword.execute(req.body.token, req.body.password, ipOf(req));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
