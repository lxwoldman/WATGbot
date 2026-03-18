import express from "express";
import QRCode from "qrcode";
import { fail, ok } from "../lib/json-response.js";
import { pushSnapshot } from "../socket/register-socket.js";

function maybeEmit(getIo, store) {
  const io = getIo?.();
  if (io) {
    pushSnapshot(io, store);
  }
}

export function createApiRouter({ store, routerService, getIo, whatsappAdapter, telegramAdapter }) {
  const router = express.Router();

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
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/whatsapp/reconnect", async (req, res) => {
    try {
      const status = await whatsappAdapter.reconnect();
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/whatsapp/logout", async (req, res) => {
    try {
      const status = await whatsappAdapter.logout();
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
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/telegram-userbot/complete-login", async (req, res) => {
    try {
      const status = await telegramAdapter.completeLogin(req.body || {});
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/integrations/telegram-userbot/logout", async (req, res) => {
    try {
      const status = await telegramAdapter.logout();
      maybeEmit(getIo, store);
      ok(res, status);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.patch("/ticket/current", (req, res) => {
    const updated = store.updateTicket(req.body || {});
    maybeEmit(getIo, store);
    ok(res, updated);
  });

  router.patch("/resources/:resourceId", (req, res) => {
    const updated = store.updateResource(req.params.resourceId, req.body || {});
    if (!updated) {
      return fail(res, "Resource not found.", 404);
    }
    maybeEmit(getIo, store);
    ok(res, updated);
  });

  router.patch("/source-channels/:sourceChannelId", (req, res) => {
    const updated = store.updateSourceChannel(req.params.sourceChannelId, req.body || {});
    if (!updated) {
      return fail(res, "Source channel not found.", 404);
    }
    maybeEmit(getIo, store);
    ok(res, updated);
  });

  router.post("/actions/source-reply", async (req, res) => {
    try {
      const { text } = req.body || {};
      if (!text) return fail(res, "text is required.");
      const sourceId = store.state.currentTicket.sourceChannelId;
      const result = await routerService.replyToSource(sourceId, text);
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
      const result = await routerService.broadcastToEnabledResources(text, (resource) => {
        if (ticket.league.includes("阿根廷") && !resource.canAmericas) {
          return false;
        }
        return true;
      });
      maybeEmit(getIo, store);
      ok(res, result);
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  router.post("/actions/broadcast-market", async (req, res) => {
    try {
      const ticket = store.getSnapshot().currentTicket;
      const result = await routerService.broadcastToEnabledResources(ticket.marketText, (resource) => {
        if (ticket.league.includes("阿根廷") && !resource.canAmericas) {
          return false;
        }
        return true;
      });
      maybeEmit(getIo, store);
      ok(res, result);
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
      const result = await routerService.broadcastToEnabledResources(text);
      maybeEmit(getIo, store);
      ok(res, result);
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
        const receipt = store.buildReceipt(resourceId, req.body?.amount, req.body?.slipCount);
        if (!receipt) return fail(res, "Resource not found.", 404);
        text = receipt.text;
      } else {
        return fail(res, "Unsupported kind.", 400);
      }
      const result = await routerService.sendToResource(resourceId, text);
      maybeEmit(getIo, store);
      ok(res, { kind, result });
    } catch (error) {
      fail(res, error.message, 500);
    }
  });

  return router;
}
