import express from "express";
import { fail, ok } from "../lib/json-response.js";
import { logger } from "../lib/logger.js";
import { pushSnapshot } from "../socket/register-socket.js";

export function createWebhookRouter({ store, getIo, whatsappAdapter, telegramAdapter }) {
  const router = express.Router();

  router.get("/whatsapp", (req, res) => {
    logger.warn("WhatsApp webhook hit, but the current adapter uses Baileys socket mode instead.");
    return fail(res, "WhatsApp Baileys does not use webhook verification.", 410);
  });

  router.post("/whatsapp", (req, res) => {
    logger.warn("WhatsApp webhook hit, but the current adapter uses Baileys socket mode instead.");
    fail(res, "WhatsApp Baileys does not use webhook mode.", 410);
  });

  router.post("/telegram", (req, res) => {
    logger.warn("Telegram webhook hit, but the current adapter uses MTProto UserBot polling instead.");
    fail(res, "Telegram UserBot does not use webhook mode.", 410);
  });

  return router;
}
