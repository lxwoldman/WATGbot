import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { assertNodeVersion, env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { verifySocketAccess } from "./lib/access-auth.js";
import { StoreService } from "./services/store-service.js";
import { ChannelRouter } from "./services/channel-router.js";
import { WhatsAppWebJsAdapter } from "./adapters/whatsapp-webjs-adapter.js";
import { TelegramUserbotAdapter } from "./adapters/telegram-userbot-adapter.js";
import { pushSnapshot, registerSocket } from "./socket/register-socket.js";

function normalizeWhatsAppMatch(value) {
  return String(value || "")
    .trim()
    .replace(/@s\.whatsapp\.net$/, "@c.us");
}

assertNodeVersion();

const store = new StoreService(env.store);
await store.initialize();
const whatsappAdapter = new WhatsAppWebJsAdapter(env.whatsapp);
const telegramAdapter = new TelegramUserbotAdapter(env.telegram);
await whatsappAdapter.initialize();
await telegramAdapter.initialize();
const routerService = new ChannelRouter({
  store,
  whatsappAdapter,
  telegramAdapter
});

let ioRef = null;

const app = createApp({
  store,
  routerService,
  getIo: () => ioRef,
  whatsappAdapter,
  telegramAdapter
});

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

io.use((socket, next) => {
  if (!verifySocketAccess(socket, env.auth)) {
    next(new Error("Authentication required."));
    return;
  }

  next();
});

ioRef = io;
registerSocket(io, store);

whatsappAdapter.on("status", (status) => {
  const isOnline = status.connection === "open";
  for (const channel of store.state.sourceChannels) {
    if (channel.type === "whatsapp") {
      channel.online = isOnline;
    }
  }

  if (ioRef) {
    pushSnapshot(ioRef, store);
  }
});

whatsappAdapter.on("message", (message) => {
  const text = message.text || "[非文本消息]";
  const sourceChannel = store.state.sourceChannels.find(
    (channel) =>
      channel.type === "whatsapp" &&
      normalizeWhatsAppMatch(channel.remoteId || "") === normalizeWhatsAppMatch(message.chatId || "")
  );

  if (sourceChannel) {
    store.state.currentTicket.sourceChannelId = sourceChannel.id;
    store.state.currentTicket.sourceMessage = {
      arrivedAt: new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toLocaleTimeString("zh-CN", {
        hour12: false
      }),
      text
    };
  }

  store.appendLog(`收到 WhatsApp 消息: ${text}`);
  if (ioRef) {
    pushSnapshot(ioRef, store);
  }
  logger.info("Received WhatsApp message", {
    chatId: message.chatId,
    text
  });
});

telegramAdapter.on("message", (message) => {
  const text = message.text || "[非文本消息]";
  const sourceChannel = store.state.sourceChannels.find(
    (channel) => channel.type === "telegram" && String(channel.remoteId || "") === String(message.chatId || "")
  );

  if (sourceChannel) {
    store.state.currentTicket.sourceChannelId = sourceChannel.id;
    store.state.currentTicket.sourceMessage = {
      arrivedAt: new Date(message.date).toLocaleTimeString("zh-CN", { hour12: false }),
      text
    };
  }

  store.appendLog(`收到 Telegram UserBot 消息: ${text}`);
  if (ioRef) {
    pushSnapshot(ioRef, store);
  }
  logger.info("Received Telegram UserBot message", {
    chatId: message.chatId,
    text
  });
});

httpServer.listen(env.port, () => {
  logger.info(`Broker Console backend listening on ${env.appBaseUrl.replace(/:\d+$/, `:${env.port}`)}`);
  logger.info("WhatsApp adapter mode: whatsapp-web.js with guarded send queue.");
  logger.info("Telegram adapter mode: UserBot via GramJS.");
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Received ${signal}, flushing in-memory state before exit.`);

  try {
    await Promise.allSettled([
      store.persistNow(),
      store.flushAudit(),
      whatsappAdapter.persistDiscoveredChats(),
      whatsappAdapter.destroy(),
      telegramAdapter.disconnectClient?.()
    ]);
  } finally {
    httpServer.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(0);
    }, 2000).unref();
  }
}

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection", {
    error: error instanceof Error ? error.message : String(error)
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error instanceof Error ? error.message : String(error)
  });
});
