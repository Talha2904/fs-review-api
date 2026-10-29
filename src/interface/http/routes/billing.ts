import { Router } from 'express';

import type { BillingAction } from '@fs-review/shared';

import type { UseCases } from '../../../application/UseCases.js';
import { ipOf, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { BillingBody, EmailInvoiceBody, XeroCallbackQuery, XeroInvoiceBody } from '../schemas/billing.js';

export function billingRoutes(uc: UseCases): Router {
  const r = Router();
  const fin = requirePerm('billing.manage');

  r.get('/billing', fin, async (req, res, next) => {
    try {
      res.json(await uc.getBilling.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });

  r.post('/billing', fin, validate({ body: BillingBody }), async (req, res, next) => {
    try {
      res.json(await uc.applyBillingAction.execute(req.actor, req.matrix, req.body.action as BillingAction, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  // Sign-off and unlock events come from the review workspace, not from Finance.
  r.get('/billing/integrations', fin, async (req, res, next) => {
    try {
      res.json(await uc.getIntegrations.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });

  r.post('/billing/email', fin, validate({ body: EmailInvoiceBody }), async (req, res, next) => {
    try {
      res.json(await uc.emailInvoice.execute(req.actor, req.matrix, req.body, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  r.post('/billing/fx-refresh', fin, async (req, res, next) => {
    try {
      res.json(await uc.refreshFxRate.execute(req.actor, req.matrix, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  // ---- Xero ----
  r.get('/xero/connect', fin, (req, res, next) => {
    try {
      res.json(uc.connectXero.start(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });

  // Xero redirects the user's browser here; it carries no api session, so the pending state is the check.
  r.get('/xero/callback', validate({ query: XeroCallbackQuery }), async (req, res) => {
    const q = req.query as unknown as { state?: string; code?: string };
    try {
      await uc.connectXero.complete(q.state, q.code);
      res.redirect('/?xero=connected');
    } catch (e) {
      res
        .status(502)
        .type('text/plain')
        .send(`Xero could not be connected: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  r.post('/xero/disconnect', fin, async (req, res, next) => {
    try {
      await uc.disconnectXero.execute(req.actor, req.matrix);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post('/xero/invoice', fin, validate({ body: XeroInvoiceBody }), async (req, res, next) => {
    try {
      res.json(await uc.sendInvoiceToXero.execute(req.actor, req.matrix, req.body.invoiceId, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
