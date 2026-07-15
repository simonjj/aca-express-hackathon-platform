'use strict';

const express = require('express');
const config = require('../lib/config');
const aca = require('../lib/aca');
const { requireApi, isAdmin } = require('../lib/auth');
const { mintApiToken } = require('../lib/tokens');

const router = express.Router();

// Every /api route requires a session cookie or a Bearer API token.
router.use(requireApi);

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.code || 'error', message: err.message || 'Internal error' });
  });
};

// Identity + platform context. When called from the browser session, also mint a
// fresh personal API token for the user to hand to their agent.
router.get(
  '/me',
  wrap(async (req, res) => {
    const admin = isAdmin(req.user);
    const body = {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email || '',
      isAdmin: admin,
      provisioningEnabled: config.provisioningEnabled,
      registryLoginServer: config.acr.loginServer || null,
      defaultSize: config.defaultReplicaSize,
    };
    if (req.authKind === 'session') {
      body.apiToken = mintApiToken(req.user);
    }
    res.json(body);
  })
);

router.get(
  '/apps',
  wrap(async (req, res) => {
    res.json({ apps: await aca.listApps(req.user, isAdmin(req.user)) });
  })
);

router.post(
  '/apps',
  wrap(async (req, res) => {
    const app = await aca.createApp(req.user, req.body || {});
    res.status(201).json({ app });
  })
);

router.get(
  '/apps/:name',
  wrap(async (req, res) => {
    res.json({ app: await aca.getApp(req.user, req.params.name, isAdmin(req.user)) });
  })
);

router.get(
  '/apps/:name/snapshots',
  wrap(async (req, res) => {
    res.json({ snapshots: await aca.listSnapshots(req.user, req.params.name, isAdmin(req.user)) });
  })
);

router.post(
  '/apps/:name/rollback',
  wrap(async (req, res) => {
    const revision = (req.body && req.body.revision) || '';
    if (!revision) {
      return res.status(400).json({ error: 'bad_request', message: 'Provide "revision" to roll back to.' });
    }
    res.json(await aca.rollback(req.user, req.params.name, revision, isAdmin(req.user)));
  })
);

router.delete(
  '/apps/:name',
  wrap(async (req, res) => {
    res.json(await aca.deleteApp(req.user, req.params.name, isAdmin(req.user)));
  })
);

module.exports = router;
