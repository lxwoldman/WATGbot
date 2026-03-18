import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import WhatsAppWebJs from "whatsapp-web.js";
import { logger } from "../lib/logger.js";

const { Client, LocalAuth } = WhatsAppWebJs;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const lower = Math.max(0, Number(min) || 0);
  const upper = Math.max(lower, Number(max) || lower);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function cleanPhoneNumber(phoneNumber) {
  return String(phoneNumber || "").replace(/\D/g, "");
}

function lastActivityToIso(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date((numeric > 10_000_000_000 ? numeric : numeric * 1000)).toISOString();
}

function normalizeChatId(value) {
  const chatId = String(value || "").trim();
  if (!chatId) return "";
  if (chatId.endsWith("@s.whatsapp.net")) {
    return chatId.replace(/@s\.whatsapp\.net$/, "@c.us");
  }
  if (chatId.includes("@")) return chatId;
  const digits = cleanPhoneNumber(chatId);
  return digits ? `${digits}@c.us` : chatId;
}

function displayNameFromChatId(chatId) {
  if (!chatId) return "";
  if (chatId.endsWith("@g.us")) {
    return `群组 ${chatId.replace(/@g\.us$/, "")}`;
  }
  return cleanPhoneNumber(chatId) || chatId;
}

export class WhatsAppWebJsAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      ...config,
      authDir: path.resolve(config.authDir),
      discoveryFile: path.resolve(config.discoveryFile || path.join(config.authDir, "_discovered-chats.json")),
      browserPath: config.browserPath || "",
      clientId: config.clientId || "primary",
      headless: config.headless !== false,
      maxQueueSize: Number(config.maxQueueSize) || 100,
      jitterMinMs: Number(config.jitterMinMs) || 500,
      jitterMaxMs: Number(config.jitterMaxMs) || 1500,
      reconnectDelayMs: Number(config.reconnectDelayMs) || 3000,
      maxReconnectAttempts: Number(config.maxReconnectAttempts) || 0,
      breakerFailureThreshold: Number(config.breakerFailureThreshold) || 5,
      breakerCooldownMs: Number(config.breakerCooldownMs) || 30000,
      discoveryAutosaveDebounceMs: Number(config.discoveryAutosaveDebounceMs) || 200
    };
    this.client = null;
    this.status = "idle";
    this.connection = "close";
    this.user = null;
    this.qr = null;
    this.pairingCode = null;
    this.lastError = null;
    this.lastDisconnectCode = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.initializingPromise = null;
    this.shouldRun = true;
    this.isManualLogout = false;
    this.pendingConnectMode = "qr";
    this.pendingPairPhoneNumber = "";
    this.queue = [];
    this.isProcessingQueue = false;
    this.consecutiveFailures = 0;
    this.circuitOpenedUntil = 0;
    this.discoveredChats = new Map();
    this.discoveryPersistTimer = null;
    this.discoveryPersistPromise = null;
  }

  isConfigured() {
    return Boolean(this.config.authDir);
  }

  isReady() {
    return this.connection === "open" && Boolean(this.client);
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      status: this.status,
      connection: this.connection,
      authenticated: this.isReady(),
      user: this.user,
      qr: this.qr,
      pairingCode: this.pairingCode,
      lastError: this.lastError,
      lastDisconnectCode: this.lastDisconnectCode,
      reconnectAttempts: this.reconnectAttempts,
      sessionDir: this.config.authDir,
      queue: {
        pending: this.queue.length,
        processing: this.isProcessingQueue,
        maxSize: this.config.maxQueueSize
      },
      circuitBreaker: {
        state: this.isCircuitOpen() ? "open" : "closed",
        consecutiveFailures: this.consecutiveFailures,
        openUntil: this.circuitOpenedUntil ? new Date(this.circuitOpenedUntil).toISOString() : null
      }
    };
  }

  async initialize() {
    await fs.mkdir(this.config.authDir, { recursive: true });
    await this.loadDiscoveredChats();
    this.setStatus("awaiting_login");
    return this.getStatus();
  }

  async connect({ mode = "qr", phoneNumber } = {}) {
    if (!this.isConfigured()) {
      throw new Error("WhatsApp auth directory is not configured.");
    }

    this.shouldRun = true;
    this.isManualLogout = false;

    if (mode === "pairing_code") {
      const normalizedPhone = cleanPhoneNumber(phoneNumber || this.config.defaultPairingPhoneNumber);
      if (!normalizedPhone) {
        throw new Error("phoneNumber is required for pairing_code mode.");
      }
      this.pendingConnectMode = "pairing_code";
      this.pendingPairPhoneNumber = normalizedPhone;
      await this.destroyClient(false);
      await this.ensureClient();
      this.connection = "connecting";
      this.setStatus("awaiting_pairing_code");
      return this.getStatus();
    }

    this.pendingConnectMode = "qr";
    this.pendingPairPhoneNumber = "";
    await this.ensureClient();
    this.connection = "connecting";
    this.setStatus("awaiting_scan");
    return this.getStatus();
  }

  async reconnect() {
    this.shouldRun = true;
    this.clearReconnectTimer();
    await this.destroyClient(false);
    await this.ensureClient();
    return this.getStatus();
  }

  async logout() {
    this.shouldRun = false;
    this.isManualLogout = true;
    this.clearReconnectTimer();

    if (this.client) {
      try {
        await this.client.logout();
      } catch (error) {
        logger.warn("WhatsApp logout failed, destroying local session anyway.", {
          error: error.message
        });
      }
    }

    await this.destroyClient(false);
    await fs.rm(this.config.authDir, { recursive: true, force: true });
    await fs.mkdir(this.config.authDir, { recursive: true });
    this.resetVolatileState();
    this.setStatus("awaiting_login");
    logger.info("WhatsApp web.js session cleared");
    return this.getStatus();
  }

  async destroy() {
    await this.destroyClient(false);
  }

  async sendText({ to, previewLabel, text }) {
    const chatId = normalizeChatId(to);
    if (!chatId) {
      logger.warn("WhatsApp target chat id missing. Falling back to dry-run.", { previewLabel });
      return {
        dryRun: true,
        reason: "missing_chat_id",
        platform: "whatsapp",
        previewLabel,
        text
      };
    }

    if (!this.isReady()) {
      logger.warn("WhatsApp client is not ready yet. Falling back to dry-run.", {
        previewLabel,
        status: this.status
      });
      return {
        dryRun: true,
        reason: "client_not_ready",
        platform: "whatsapp",
        previewLabel,
        text
      };
    }

    this.assertCircuitClosed();

    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`WhatsApp send queue is full (${this.config.maxQueueSize}).`);
    }

    return await new Promise((resolve, reject) => {
      this.queue.push({
        chatId,
        text,
        previewLabel,
        resolve,
        reject
      });
      void this.processQueue();
    });
  }

  listChats(limit = 50) {
    return [...this.discoveredChats.values()]
      .sort((left, right) => {
        const leftTs = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
        const rightTs = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
        return rightTs - leftTs;
      })
      .slice(0, Math.max(1, Number(limit) || 50))
      .map((chat) => ({
        ...chat,
        label: chat.title || displayNameFromChatId(chat.remoteId)
      }));
  }

  async ensureClient() {
    if (this.client) {
      return this.client;
    }

    if (this.initializingPromise) {
      return await this.initializingPromise;
    }

    this.initializingPromise = this.buildClient();
    try {
      return await this.initializingPromise;
    } finally {
      this.initializingPromise = null;
    }
  }

  async buildClient() {
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.config.clientId,
        dataPath: this.config.authDir
      }),
      browserName: "Chrome",
      deviceName: this.config.browserName || "SupplyConsolePro",
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      qrMaxRetries: 0,
      pairWithPhoneNumber:
        this.pendingConnectMode === "pairing_code" && this.pendingPairPhoneNumber
          ? {
              phoneNumber: this.pendingPairPhoneNumber,
              showNotification: true,
              intervalMs: 180000
            }
          : undefined,
      puppeteer: {
        headless: this.config.headless,
        executablePath: this.config.browserPath || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]
      }
    });

    this.bindClientEvents(client);
    this.client = client;
    this.connection = "connecting";
    this.lastError = null;
    this.lastDisconnectCode = null;
    this.setStatus("connecting");
    void client.initialize().catch((error) => {
      this.lastError = error.message;
      this.connection = "close";
      this.client = null;
      this.setStatus("error");
      logger.error("WhatsApp web.js initialization failed", {
        error: error.message
      });
    });
    return client;
  }

  bindClientEvents(client) {
    client.on("qr", (qr) => {
      this.qr = qr;
      this.pairingCode = null;
      this.lastError = null;
      this.connection = "connecting";
      this.setStatus("awaiting_scan");
    });

    client.on("code", (code) => {
      this.pairingCode = code;
      this.qr = null;
      this.lastError = null;
      this.connection = "connecting";
      this.setStatus("awaiting_pairing_code");
    });

    client.on("authenticated", () => {
      this.connection = "connecting";
      this.lastError = null;
      this.setStatus("authenticated");
    });

    client.on("ready", async () => {
      this.connection = "open";
      this.qr = null;
      this.pairingCode = null;
      this.lastError = null;
      this.lastDisconnectCode = null;
      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;
      this.circuitOpenedUntil = 0;
      this.user = {
        id: client.info?.wid?._serialized || "",
        name: client.info?.pushname || "",
        platform: client.info?.platform || ""
      };
      this.setStatus("ready");
      await this.refreshChats();
      logger.info("WhatsApp web.js client ready", {
        userId: this.user?.id || ""
      });
    });

    client.on("auth_failure", (message) => {
      this.lastError = message || "Authentication failure";
      this.connection = "close";
      this.setStatus("auth_failure");
      logger.error("WhatsApp authentication failure", {
        error: this.lastError
      });
    });

    client.on("disconnected", (reason) => {
      this.connection = "close";
      this.client = null;
      this.lastError = String(reason || "Connection Closed");
      this.lastDisconnectCode = null;
      const shouldReconnect = this.shouldRun && !this.isManualLogout;
      this.setStatus(shouldReconnect ? "reconnecting" : "closed");

      logger.warn("WhatsApp web.js client disconnected", {
        reason: this.lastError,
        shouldReconnect
      });

      if (shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    client.on("message", async (message) => {
      const remoteId = normalizeChatId(message.from);
      this.upsertDiscoveredChat({
        remoteId,
        title: message._data?.notifyName || "",
        lastMessageAt: lastActivityToIso(message.timestamp),
        isGroup: remoteId.endsWith("@g.us"),
        previewText: message.body || "",
        source: "message_inbound"
      });

      this.emit("message", {
        id: message.id?._serialized || "",
        chatId: remoteId,
        participant: message.author || "",
        text: message.body || "",
        timestamp: Number(message.timestamp || Date.now() / 1000),
        isGroup: remoteId.endsWith("@g.us")
      });
    });

    client.on("message_create", async (message) => {
      if (!message.fromMe) return;
      const remoteId = normalizeChatId(message.to || message.from);
      this.upsertDiscoveredChat({
        remoteId,
        lastMessageAt: lastActivityToIso(message.timestamp),
        isGroup: remoteId.endsWith("@g.us"),
        previewText: message.body || "",
        source: "message_echo"
      });
    });
  }

  shouldReconnect() {
    return this.shouldRun && !this.isManualLogout;
  }

  scheduleReconnect() {
    this.clearReconnectTimer();

    const hasReconnectCap = this.config.maxReconnectAttempts > 0;
    if (hasReconnectCap && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setStatus("reconnect_exhausted");
      logger.error("WhatsApp reconnect attempts exhausted", {
        attempts: this.reconnectAttempts
      });
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(this.config.reconnectDelayMs * this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      void this.ensureClient().catch((error) => {
        this.lastError = error.message;
        this.setStatus("error");
        logger.error("Failed to reconnect WhatsApp web.js client", { error: error.message });
      });
    }, delayMs);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  isCircuitOpen() {
    if (!this.circuitOpenedUntil) {
      return false;
    }

    if (Date.now() >= this.circuitOpenedUntil) {
      this.circuitOpenedUntil = 0;
      this.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  assertCircuitClosed() {
    if (!this.isCircuitOpen()) {
      return;
    }

    throw new Error(
      `WhatsApp dispatch circuit is open until ${new Date(this.circuitOpenedUntil).toISOString()}.`
    );
  }

  recordSendSuccess() {
    this.consecutiveFailures = 0;
    this.circuitOpenedUntil = 0;
  }

  recordSendFailure(error) {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.breakerFailureThreshold) {
      this.circuitOpenedUntil = Date.now() + this.config.breakerCooldownMs;
      logger.warn("WhatsApp circuit breaker opened", {
        reason: error.message,
        openUntil: new Date(this.circuitOpenedUntil).toISOString()
      });
    }
  }

  async processQueue() {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queue.length) {
      const task = this.queue.shift();
      if (!task) continue;

      try {
        this.assertCircuitClosed();
        const chat = await this.client.getChatById(task.chatId);
        const jitterMs = randomBetween(this.config.jitterMinMs, this.config.jitterMaxMs);
        await chat.sendStateTyping();
        await sleep(jitterMs);
        const payload = await this.client.sendMessage(task.chatId, task.text);
        await chat.clearState().catch(() => {});
        this.recordSendSuccess();
        this.upsertDiscoveredChat({
          remoteId: task.chatId,
          title: task.previewLabel,
          lastMessageAt: new Date().toISOString(),
          previewText: task.text,
          source: "outbound_send"
        });

        task.resolve({
          dryRun: false,
          platform: "whatsapp",
          jid: task.chatId,
          messageId: payload?.id?._serialized || null,
          delayMs: jitterMs
        });
      } catch (error) {
        this.recordSendFailure(error);
        task.reject(error);
      }
    }

    this.isProcessingQueue = false;
  }

  async refreshChats() {
    if (!this.client) return;
    try {
      const chats = await this.client.getChats();
      for (const chat of chats) {
        const remoteId = normalizeChatId(chat.id?._serialized);
        if (!remoteId) continue;
        this.upsertDiscoveredChat({
          remoteId,
          title: chat.name || chat.formattedTitle || "",
          isGroup: Boolean(chat.isGroup),
          lastMessageAt: lastActivityToIso(chat.timestamp),
          previewText: chat.lastMessage?.body || "",
          source: "chat_sync"
        });
      }
    } catch (error) {
      logger.warn("Failed to refresh WhatsApp chats list.", {
        error: error.message
      });
    }
  }

  upsertDiscoveredChat(entry) {
    const remoteId = normalizeChatId(entry?.remoteId);
    if (!remoteId || remoteId === "status@broadcast") {
      return;
    }

    const previous = this.discoveredChats.get(remoteId) || {};
    const normalized = {
      remoteId,
      platform: "whatsapp",
      title: entry?.title || previous.title || displayNameFromChatId(remoteId),
      phone: cleanPhoneNumber(entry?.phone || previous.phone || remoteId),
      type: entry?.isGroup || remoteId.endsWith("@g.us") ? "group" : "private",
      lastMessageAt: entry?.lastMessageAt || previous.lastMessageAt || null,
      previewText: entry?.previewText || previous.previewText || "",
      source: entry?.source || previous.source || ""
    };

    this.discoveredChats.set(remoteId, normalized);
    this.scheduleDiscoveryPersist();
  }

  async loadDiscoveredChats() {
    try {
      const raw = await fs.readFile(this.config.discoveryFile, "utf8");
      const parsed = JSON.parse(raw);
      for (const chat of parsed?.chats || []) {
        if (!chat?.remoteId) continue;
        this.discoveredChats.set(chat.remoteId, chat);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn("Failed to restore WhatsApp discovered chats cache.", {
          error: error.message
        });
      }
    }
  }

  scheduleDiscoveryPersist() {
    clearTimeout(this.discoveryPersistTimer);
    this.discoveryPersistTimer = setTimeout(() => {
      void this.persistDiscoveredChats();
    }, this.config.discoveryAutosaveDebounceMs);
  }

  async persistDiscoveredChats() {
    clearTimeout(this.discoveryPersistTimer);
    this.discoveryPersistTimer = null;

    if (this.discoveryPersistPromise) {
      return await this.discoveryPersistPromise;
    }

    this.discoveryPersistPromise = (async () => {
      await fs.mkdir(path.dirname(this.config.discoveryFile), { recursive: true });
      await fs.writeFile(
        this.config.discoveryFile,
        JSON.stringify(
          {
            savedAt: new Date().toISOString(),
            chats: this.listChats(300)
          },
          null,
          2
        )
      );
    })();

    try {
      await this.discoveryPersistPromise;
    } finally {
      this.discoveryPersistPromise = null;
    }
  }

  async destroyClient(clearAuth = false) {
    this.clearReconnectTimer();
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        logger.warn("Failed to destroy WhatsApp client cleanly.", {
          error: error.message
        });
      }
    }

    if (clearAuth) {
      await fs.rm(this.config.authDir, { recursive: true, force: true });
      await fs.mkdir(this.config.authDir, { recursive: true });
    }
  }

  resetVolatileState() {
    this.connection = "close";
    this.user = null;
    this.qr = null;
    this.pairingCode = null;
    this.lastError = null;
    this.lastDisconnectCode = null;
    this.reconnectAttempts = 0;
    this.queue = [];
    this.isProcessingQueue = false;
    this.consecutiveFailures = 0;
    this.circuitOpenedUntil = 0;
    this.discoveredChats.clear();
    this.scheduleDiscoveryPersist();
  }

  setStatus(status) {
    this.status = status;
    this.emit("status", this.getStatus());
  }
}
