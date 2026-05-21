"use strict";

const TRUSTED_ACTION_HEADER = "x-agent-dashboard-trusted-action";
const TRUSTED_ACTION_VALUE = "catalog-mutate";
const ALLOWED_ORIGIN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

function firstHeaderValue(raw) {
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[0] : null;
  }
  return typeof raw === "string" ? raw : null;
}

function isAllowedDashboardOrigin(origin) {
  if (!origin || origin === "null") return false;
  try {
    const url = new URL(origin);
    const expectedPort = String(process.env.DASHBOARD_PORT || "4820");
    return (
      url.protocol === "http:" &&
      ALLOWED_ORIGIN_HOSTS.has(url.hostname) &&
      url.port === expectedPort
    );
  } catch {
    return false;
  }
}

function validateTrustedCatalogAction(req) {
  const origin = firstHeaderValue(req.headers && req.headers.origin);
  if (!origin || origin === "null") {
    return {
      ok: false,
      statusCode: 403,
      error: {
        code: "EORIGINREQUIRED",
        message: "Origin header required for catalog install/uninstall",
      },
    };
  }
  if (!isAllowedDashboardOrigin(origin)) {
    return {
      ok: false,
      statusCode: 403,
      error: {
        code: "EBADORIGIN",
        message: "cross-origin requests are not allowed",
      },
    };
  }
  const trustedAction = firstHeaderValue(
    req.headers && req.headers[TRUSTED_ACTION_HEADER],
  );
  if (trustedAction !== TRUSTED_ACTION_VALUE) {
    return {
      ok: false,
      statusCode: 403,
      error: {
        code: "EUNTRUSTEDACTION",
        message: "missing trusted action header",
      },
    };
  }
  return { ok: true };
}

function createCatalogActionHandler({
  db,
  installOrchestrator,
  packScanner,
}) {
  return function createHandler(action) {
    return function handleCatalogAction(req, res) {
      const trust = validateTrustedCatalogAction(req);
      if (!trust.ok) {
        res.status(trust.statusCode).json({ error: trust.error });
        return;
      }

      const harness =
        typeof req.query.harness === "string" && req.query.harness.trim()
          ? req.query.harness.trim()
          : null;
      if (!harness) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "harness query param required",
          },
        });
        return;
      }

      const requestedCwd =
        req.body &&
        typeof req.body.cwd === "string" &&
        req.body.cwd.trim().length > 0
          ? req.body.cwd.trim()
          : typeof req.query.cwd === "string" && req.query.cwd.trim().length > 0
            ? req.query.cwd.trim()
            : null;

      installOrchestrator.streamRun(db, {
        pack_id: req.params.pack_id,
        harness,
        action,
        cwd: requestedCwd,
        res,
        onComplete: ({ exit_code, killed }) => {
          if (!killed && exit_code === 0) {
            try {
              packScanner.runPackScanner(db);
            } catch (e) {
              console.warn(
                "[catalog-route] post-install rescan failed:",
                e && e.message,
              );
            }
          }
        },
      });
    };
  };
}

module.exports = {
  TRUSTED_ACTION_HEADER,
  TRUSTED_ACTION_VALUE,
  isAllowedDashboardOrigin,
  validateTrustedCatalogAction,
  createCatalogActionHandler,
};
