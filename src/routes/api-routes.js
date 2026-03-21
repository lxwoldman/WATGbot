import express from "express";
import QRCode from "qrcode";
import { getRequestActor } from "../lib/request-actor.js";
import { fail, ok } from "../lib/json-response.js";
import { pushSnapshot } from "../socket/register-socket.js";

function maybeEmit(getIo, store) {
  const io = getIo?.();
  if (io) {
    pushSnapshot(io, store);
  }
}

function sanitizeString(value) {
  return String(value ?? "").trim();
}

function sanitizeNumber(value, fallback = 0, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(parsed, minimum);
}

function sanitizeBoolean(value) {
  return Boolean(value);
}

function sanitizeCustomCommands(commands) {
  if (!Array.isArray(commands)) {
    return undefined;
  }

  return commands
    .map((command, index) => {
      const text = sanitizeString(command?.text);
      const label = sanitizeString(command?.label);
      if (!text) {
        return null;
      }

      return {
        id: sanitizeString(command?.id) || `cmd-${index + 1}`,
        label: label || text.slice(0, 8) || `指令 ${index + 1}`,
        text
      };
    })
    .filter(Boolean);
}

function sanitizeConsoleSettingsPatch(payload = {}) {
  const patch = {};

  if ("exchangeRate" in payload) {
    patch.exchangeRate = sanitizeNumber(payload.exchangeRate, 7, 0.01);
  }
  if ("specialTarget" in payload) {
    patch.specialTarget = sanitizeNumber(payload.specialTarget, 0, 0);
  }
  if ("followAmount" in payload) {
    patch.followAmount = sanitizeNumber(payload.followAmount, 0, 0);
  }
  if ("manualAmericas" in payload) {
    patch.manualAmericas = sanitizeBoolean(payload.manualAmericas);
  }
  if ("safetyLock" in payload) {
    patch.safetyLock = sanitizeBoolean(payload.safetyLock);
  }
  if ("customCommands" in payload) {
    const commands = sanitizeCustomCommands(payload.customCommands);
    if (commands) {
      patch.customCommands = commands;
    }
  }

  return patch;
}

function sanitizeTicketPatch(payload = {}) {
  const patch = {};

  if ("sourceChannelId" in payload) {
    patch.sourceChannelId = sanitizeString(payload.sourceChannelId);
  }
  if ("isAmericasOrder" in payload) {
    patch.isAmericasOrder = sanitizeBoolean(payload.isAmericasOrder);
  }
  if ("league" in payload) {
    patch.league = sanitizeString(payload.league);
  }
  if ("teams" in payload) {
    patch.teams = sanitizeString(payload.teams);
  }
  if ("marketText" in payload) {
    patch.marketText = sanitizeString(payload.marketText);
  }
  if ("rawOdds" in payload) {
    patch.rawOdds = sanitizeNumber(payload.rawOdds, 0, 0);
  }
  if ("rebate" in payload) {
    patch.rebate = sanitizeNumber(payload.rebate, 0, 0);
  }
  if ("deliveryTarget" in payload) {
    patch.deliveryTarget = sanitizeNumber(payload.deliveryTarget, 0, 0);
  }
  if ("internalTarget" in payload) {
    patch.internalTarget = sanitizeNumber(payload.internalTarget, 0, 0);
  }

  return patch;
}

function sanitizeResourcePatch(payload = {}) {
  const patch = {};

  if ("name" in payload) {
    patch.name = sanitizeString(payload.name);
  }
  if ("remoteId" in payload) {
    patch.remoteId = sanitizeString(payload.remoteId);
  }
  if ("bindingLabel" in payload) {
    patch.bindingLabel = sanitizeString(payload.bindingLabel);
  }
  if ("note" in payload) {
    patch.note = sanitizeString(payload.note);
  }
  if ("enabled" in payload) {
    patch.enabled = sanitizeBoolean(payload.enabled);
  }
  if ("sendEnabled" in payload) {
    patch.sendEnabled = sanitizeBoolean(payload.sendEnabled);
  }
  if ("includeInAllocation" in payload) {
    patch.includeInAllocation = sanitizeBoolean(payload.includeInAllocation);
  }
  if ("liveDispatch" in payload) {
    patch.liveDispatch = sanitizeBoolean(payload.liveDispatch);
  }
  if ("canAmericas" in payload) {
    patch.canAmericas = sanitizeBoolean(payload.canAmericas);
  }
  if ("amount" in payload) {
    patch.amount = sanitizeNumber(payload.amount, 0, 0);
  }
  if ("slipCount" in payload) {
    patch.slipCount = sanitizeNumber(payload.slipCount, 0, 0);
  }
  if ("allocationType" in payload) {
    patch.allocationType = sanitizeString(payload.allocationType) === "floating" ? "floating" : "fixed";
  }
  if ("currency" in payload) {
    patch.currency = sanitizeString(payload.currency) === "RMB" ? "RMB" : "U";
  }

  return patch;
}

function sanitizeSourceChannelPatch(payload = {}) {
  const patch = {};

  if ("label" in payload) {
    patch.label = sanitizeString(payload.label);
  }
  if ("remoteId" in payload) {
    patch.remoteId = sanitizeString(payload.remoteId);
  }
  if ("note" in payload) {
    patch.note = sanitizeString(payload.note);
  }
  if ("online" in payload) {
    patch.online = sanitizeBoolean(payload.online);
  }

  return patch;
}

function buildDispatchResponse(summary) {
  return {
    partialFailure: summary.failed > 0,
    ...summary
  };
}

function buildFailedDispatchItems(summary) {
  return summary.items
    .filter((item) => item.status === "failed")
    .map((item) => ({
      resourceId: item.resourceId,
      resourceName: item.resourceName,
      error: item.error
    }));
}

export function createApiRouter({ store, routerService, getIo, whatsappAdapter, telegramAdapter }) {
  const router = express.Router();

  async function audit(req, action, target, details = {}) {
    await store.recordAudit({
      actor: getRequestActor(req),
      action,
      target,
      details
    });
  }

  function isSafetyLockUnlockPatch(req) {
    if (req.method !== "PATCH" || req.path !== "/console-settings") {
      return false;
    }

    const patch = sanitizeConsoleSettingsPatch(req.body || {});
    return Object.keys(patch).length === 1 && patch.safetyLock === false;
  }

  router.use((req, res, next) => {
    if (!store.state.consoleSettings?.safetyLock) {
      next();
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      next();
      return;
    }

    if (isSafetyLockUnlockPatch(req)) {
      next();
      return;
    }

    void audit(req, "safety_lock.blocked", req.path, {
      method: req.method
    });
    fail(res, "Safety lock is enabled. Unlock before operating.", 423);
  });

  async function buildRecentChats(limit = 80) {
    const [whatsappChats, telegramDialogs] = await Promise.all([
      Promise.resolve(whatsappAdapter.listChats(limit)),
      telegramAdapter.listDialogs(limit)
    ]);

    return [...whatsappChats, ...telegramDialogs].sort((left, right) => {
      const leftTs = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
      const rightTs = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
      return rightTs - leftTs;
    });
  }

  async function buildWhatsAppStatus() {
    const status = whatsappAdapter.getStatus();
    return {
      ...status,
      qrDataUrl: status.qr ? await QRCode.toDataURL(status.qr, { margin: 1, width: 220 }) : null
    };
  }

  router.get("/health", (req, res) => {
    const whatsappStatus = whatsappAdapter.getStatus();
    const telegramStatus = telegramAdapter.getStatus();
    ok(res, {
      status: "ok",
      services: {
        whatsappBaileysConfigured: whatsappStatus.configured,
        whatsappBaileysConnected: whatsappStatus.connection === "open",
        whatsappBaileysStatus: whatsappStatus.status,
        telegramUserbotConfigured: telegramStatus.configured,
        telegramUserbotAuthorized: telegramStatus.authorized,
        telegramUserbotStatus: telegramStatus.status
      }
    });
  });

  router.get("/bootstrap", (req, res) => {
    ok(res, store.getSnapshot());
  });

  router.patch("/console-settings", async (req, res) => {
    try {
      const patch = sanitizeConsoleSettingsPatch(req.body || {});
      const updated = store.updateConsoleSettings(patch);
      await audit(req, "console_settings.update", "console_settings", {
        keys: Object.keys(patch)
      });
      maybeEmit(getIo, store);
      ok(res, updated);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.get("/discovery/recent-chats", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 80;
      ok(res, await buildRecentChats(limit));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.get("/integrations/whatsapp/status", (req, res) => {
    buildWhatsAppStatus()
      .then((status) => ok(res, status))
      .catch((error) => fail(res, error.message, 500));
  });

  router.get("/integrations/whatsapp/chats", (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      ok(res, whatsappAdapter.listChats(limit));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/whatsapp/connect", async (req, res) => {
    try {
      const status = await whatsappAdapter.connect(req.body || {});
      await audit(req, "whatsapp.connect", "integration.whatsapp", {
        mode: sanitizeString(req.body?.mode || "qr")
      });
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/whatsapp/reconnect", async (req, res) => {
    try {
      const status = await whatsappAdapter.reconnect();
      await audit(req, "whatsapp.reconnect", "integration.whatsapp");
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/whatsapp/logout", async (req, res) => {
    try {
      const status = await whatsappAdapter.logout();
      await audit(req, "whatsapp.logout", "integration.whatsapp");
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.get("/integrations/telegram-userbot/status", (req, res) => {
    ok(res, telegramAdapter.getStatus());
  });

  router.get("/integrations/telegram-userbot/dialogs", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const dialogs = await telegramAdapter.listDialogs(limit);
      ok(res, dialogs);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/telegram-userbot/request-code", async (req, res) => {
    try {
      const status = await telegramAdapter.requestLoginCode(req.body || {});
      await audit(req, "telegram.request_code", "integration.telegram_userbot");
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/telegram-userbot/complete-login", async (req, res) => {
    try {
      const status = await telegramAdapter.completeLogin(req.body || {});
      await audit(req, "telegram.complete_login", "integration.telegram_userbot");
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/telegram-userbot/logout", async (req, res) => {
    try {
      const status = await telegramAdapter.logout();
      await audit(req, "telegram.logout", "integration.telegram_userbot");
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.patch("/ticket/current", async (req, res) => {
    try {
      const patch = sanitizeTicketPatch(req.body || {});
      const updated = store.updateTicket(patch);
      await audit(req, "ticket.update", "ticket.current", {
        keys: Object.keys(patch)
      });
      maybeEmit(getIo, store);
      ok(res, updated);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.patch("/resources/:resourceId", async (req, res) => {
    try {
      const patch = sanitizeResourcePatch(req.body || {});
      const updated = store.updateResource(req.params.resourceId, patch);
      if (!updated) {
        return fail(res, "Resource not found.", 404);
      }
      await audit(req, "resource.update", `resource.${req.params.resourceId}`, {
        keys: Object.keys(patch)
      });
      maybeEmit(getIo, store);
      ok(res, updated);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.patch("/source-channels/:sourceChannelId", async (req, res) => {
    try {
      const patch = sanitizeSourceChannelPatch(req.body || {});
      const updated = store.updateSourceChannel(req.params.sourceChannelId, patch);
      if (!updated) {
        return fail(res, "Source channel not found.", 404);
      }
      await audit(req, "source_channel.update", `source_channel.${req.params.sourceChannelId}`, {
        keys: Object.keys(patch)
      });
      maybeEmit(getIo, store);
      ok(res, updated);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/bindings", (req, res) => {
    try {
      const role = String(req.body?.role || "").trim();
      const platform = String(req.body?.platform || "").trim();
      const remoteId = String(req.body?.remoteId || "").trim();
      const note = String(req.body?.note || "").trim();
      const title = String(req.body?.title || "").trim();

      if (!["supplier", "distributor"].includes(role)) {
        return fail(res, "role must be supplier or distributor.", 400);
      }

      if (!["whatsapp", "telegram"].includes(platform)) {
        return fail(res, "platform must be whatsapp or telegram.", 400);
      }

      if (!remoteId) {
        return fail(res, "remoteId is required.", 400);
      }

      const created =
        role === "supplier"
          ? store.upsertSourceChannelFromChat({
              type: platform,
              remoteId,
              label: note || title || remoteId,
              note
            })
          : store.upsertResourceFromChat({
              platform,
              remoteId,
              name: note || title || remoteId,
              note
            });

      audit(req, "binding.upsert", `${role}.${created.id}`, {
        role,
        platform,
        remoteId
      })
        .then(() => {
          maybeEmit(getIo, store);
          ok(res, created);
        })
        .catch((error) => fail(res, error.message, 500));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.delete("/source-channels/:sourceChannelId", async (req, res) => {
    const removed = store.removeSourceChannel(req.params.sourceChannelId);
    if (!removed) {
      return fail(res, "Source channel not found.", 404);
    }
    await audit(req, "source_channel.delete", `source_channel.${req.params.sourceChannelId}`, {
      label: removed.label
    });
    maybeEmit(getIo, store);
    ok(res, removed);
  });

  router.delete("/resources/:resourceId", async (req, res) => {
    const removed = store.removeResource(req.params.resourceId);
    if (!removed) {
      return fail(res, "Resource not found.", 404);
    }
    await audit(req, "resource.delete", `resource.${req.params.resourceId}`, {
      name: removed.name
    });
    maybeEmit(getIo, store);
    ok(res, removed);
  });

  router.post("/actions/source-reply", async (req, res) => {
    try {
      const { text } = req.body || {};
      if (!text) return fail(res, "text is required.");
      const sourceId = store.state.currentTicket.sourceChannelId;
      const result = await routerService.replyToSource(sourceId, text);
      await audit(req, "action.source_reply", `source_channel.${sourceId}`, {
        text: sanitizeString(text)
      });
      maybeEmit(getIo, store);
      ok(res, result);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/actions/broadcast-prep", async (req, res) => {
    try {
      const ticket = store.getSnapshot().currentTicket;
      const text = `${ticket.league}\n${ticket.teams}\n预备单`;
      const summary = await routerService.broadcastToEnabledResources(text, () => true, ticket);
      store.recordDispatchSummary("broadcast_prep", summary, text);
      await audit(req, "action.broadcast_prep", "resources.enabled", {
        ticketId: ticket.id,
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        failedItems: buildFailedDispatchItems(summary)
      });
      maybeEmit(getIo, store);
      ok(res, buildDispatchResponse(summary));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/actions/broadcast-market", async (req, res) => {
    try {
      const ticket = store.getSnapshot().currentTicket;
      const summary = await routerService.broadcastToEnabledResources(ticket.marketText, () => true, ticket);
      store.recordDispatchSummary("broadcast_market", summary, ticket.marketText);
      await audit(req, "action.broadcast_market", "resources.enabled", {
        ticketId: ticket.id,
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        failedItems: buildFailedDispatchItems(summary)
      });
      maybeEmit(getIo, store);
      ok(res, buildDispatchResponse(summary));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/actions/broadcast-custom", async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) {
        return fail(res, "text is required.");
      }
      const ticket = store.getSnapshot().currentTicket;
      const summary = await routerService.broadcastToEnabledResources(text, () => true, ticket);
      store.recordDispatchSummary("broadcast_custom", summary, text);
      await audit(req, "action.broadcast_custom", "resources.enabled", {
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        failedItems: buildFailedDispatchItems(summary),
        text
      });
      maybeEmit(getIo, store);
      ok(res, buildDispatchResponse(summary));
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/actions/resources/:resourceId/:kind", async (req, res) => {
    try {
      const { resourceId, kind } = req.params;
      let text;
      if (kind === "prep") {
        const ticket = store.getSnapshot().currentTicket;
        text = `${ticket.league}\n${ticket.teams}\n预备单`;
      } else if (kind === "market") {
        text = store.getSnapshot().currentTicket.marketText;
      } else if (kind === "receipt") {
        const customText = String(req.body?.text || "").trim();
        if (customText) {
          text = customText;
        } else {
          const receipt = store.buildReceipt(resourceId, req.body?.amount, req.body?.slipCount);
          if (!receipt) return fail(res, "Resource not found.", 404);
          text = receipt.text;
        }
      } else {
        return fail(res, "Unsupported kind.", 400);
      }
      const ticket = store.getSnapshot().currentTicket;
      const result = await routerService.sendToResource(resourceId, text, { ticket });
      await audit(req, "action.resource_send", `resource.${resourceId}`, {
        kind,
        text
      });
      maybeEmit(getIo, store);
      ok(res, { kind, result });
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  return router;
}
