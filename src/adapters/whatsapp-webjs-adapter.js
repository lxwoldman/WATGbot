import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
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

const ACCEPTED_WA_STATES = new Set(["CONNECTED", "OPENING", "PAIRING", "TIMEOUT", "CONFLICT"]);

function withTimeout(promise, ms, label = "operation_timeout") {
  const timeoutMs = Math.max(1000, Number(ms) || 0);
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(label));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function isLikelyRuntimeContextError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("execution context was destroyed") ||
    text.includes("runtime.callfunctionon") ||
    text.includes("target closed") ||
    text.includes("session closed") ||
    text.includes("page crashed") ||
    text.includes("page closed")
  );
}

function isLikelyLoginLost(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("logout") ||
    text.includes("unpaired") ||
    text.includes("auth_failure") ||
    text.includes("authentication failure")
  );
}

export class WhatsAppWebJsAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      ...config,
      authDir: path.resolve(config.authDir),
      sessionDataDir: path.resolve(config.authDir, `session-${config.clientId || "primary"}`),
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
      discoveryAutosaveDebounceMs: Number(config.discoveryAutosaveDebounceMs) || 200,
      healthCheckIntervalMs: Number(config.healthCheckIntervalMs) || 20000,
      healthCheckTimeoutMs: Number(config.healthCheckTimeoutMs) || 10000,
      maxHealthFailures: Math.max(1, Number(config.maxHealthFailures) || 2)
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
    this.cleanupPromise = null;
    this.recoveryPromise = null;
    this.healthCheckTimer = null;
    this.consecutiveHealthFailures = 0;
    this.lastWaState = null;
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
      waState: this.lastWaState,
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
      },
      healthCheck: {
        intervalMs: this.config.healthCheckIntervalMs,
        timeoutMs: this.config.healthCheckTimeoutMs,
        consecutiveFailures: this.consecutiveHealthFailures,
        maxFailures: this.config.maxHealthFailures
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
    await this.ensureSessionBrowserStopped();

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: this.config.clientId,
        dataPath: this.config.authDir
      }),
      authTimeoutMs: 60000,
      browserName: "Chrome",
      deviceName: this.config.browserName || "SupplyConsolePro",
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      qrMaxRetries: 0,
      webVersionCache: {
        type: "local"
      },
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
        protocolTimeout: 120000,
        executablePath: this.config.browserPath || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=Translate,OptimizationHints,PaintHolding,BackForwardCache,AcceptCHFrame",
          "--disable-extensions",
          "--disable-sync",
          "--disable-infobars",
          "--no-first-run",
          "--no-default-browser-check",
          "--password-store=basic",
          "--use-mock-keychain"
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
      if (this.shouldReconnect()) {
        this.scheduleReconnect();
      }
    });
    return client;
  }

  bindClientEvents(client) {
    client.on("change_state", (state) => {
      this.lastWaState = String(state || "");
      if (state === "CONNECTED") {
        this.lastError = null;
      }
      if (!ACCEPTED_WA_STATES.has(this.lastWaState)) {
        logger.warn("WhatsApp state changed to unstable value", {
          state: this.lastWaState
        });
      }
      this.emit("status", this.getStatus());
    });

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
      this.bindRuntimeObservers(client);
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
      this.consecutiveHealthFailures = 0;
      this.user = {
        id: client.info?.wid?._serialized || "",
        name: client.info?.pushname || "",
        platform: client.info?.platform || ""
      };
      this.bindRuntimeObservers(client);
      this.startHealthChecks();
      this.setStatus("ready");
      await this.refreshChats();
      logger.info("WhatsApp web.js client ready", {
        userId: this.user?.id || ""
      });
    });

    client.on("auth_failure", (message) => {
      this.stopHealthChecks();
      this.lastError = message || "Authentication failure";
      this.connection = "close";
      this.client = null;
      this.setStatus("auth_failure");
      logger.error("WhatsApp authentication failure", {
        error: this.lastError
      });

      void this.cleanupDisconnectedClient(client);
    });

    client.on("disconnected", (reason) => {
      this.stopHealthChecks();
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

      void this.cleanupDisconnectedClient(client);

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
      void this.recoverClient("scheduled_reconnect").catch((error) => {
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

  bindRuntimeObservers(client) {
    if (!client?.pupBrowser || !client?.pupPage || client.__supplyConsoleRuntimeBound) {
      return;
    }

    client.__supplyConsoleRuntimeBound = true;

    client.pupBrowser.on("disconnected", () => {
      void this.handleRuntimeInstability(client, "browser_disconnected");
    });

    client.pupPage.on("close", () => {
      void this.handleRuntimeInstability(client, "page_closed");
    });

    client.pupPage.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("WhatsApp page runtime error detected", { error: message });
      void this.handleRuntimeInstability(client, message || "page_error");
    });
  }

  async handleRuntimeInstability(client, reason) {
    if (!client || client !== this.client || client.__supplyConsoleDestroying) {
      return;
    }

    if (!this.shouldReconnect()) {
      return;
    }

    logger.warn("WhatsApp runtime instability detected", { reason: String(reason || "unknown") });
    await this.recoverClient("runtime_instability", { reason });
  }

  startHealthChecks() {
    this.stopHealthChecks();

    if (this.config.healthCheckIntervalMs <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, this.config.healthCheckIntervalMs);

    this.healthCheckTimer.unref?.();
  }

  stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.consecutiveHealthFailures = 0;
  }

  async runHealthCheck() {
    const client = this.client;
    if (!client || this.connection !== "open" || this.status !== "ready" || this.recoveryPromise) {
      return;
    }

    try {
      const waState = await withTimeout(
        client.getState(),
        this.config.healthCheckTimeoutMs,
        "whatsapp_healthcheck_timeout"
      );

      this.lastWaState = String(waState || this.lastWaState || "");

      if (!ACCEPTED_WA_STATES.has(this.lastWaState)) {
        throw new Error(`unexpected_wa_state:${this.lastWaState || "unknown"}`);
      }

      if (!client.pupBrowser?.isConnected?.()) {
        throw new Error("browser_disconnected");
      }

      if (client.pupPage?.isClosed?.()) {
        throw new Error("page_closed");
      }

      this.consecutiveHealthFailures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.consecutiveHealthFailures += 1;
      this.lastError = message;
      logger.warn("WhatsApp health check failed", {
        error: message,
        consecutiveFailures: this.consecutiveHealthFailures
      });

      if (this.consecutiveHealthFailures < this.config.maxHealthFailures) {
        return;
      }

      this.consecutiveHealthFailures = 0;
      await this.recoverClient("health_check_failure", { reason: message });
    }
  }

  async recoverClient(trigger, { reason } = {}) {
    if (this.recoveryPromise) {
      return await this.recoveryPromise;
    }

    if (!this.shouldReconnect()) {
      return this.getStatus();
    }

    const detail = reason ? `${trigger}: ${reason}` : trigger;

    this.recoveryPromise = (async () => {
      this.stopHealthChecks();
      this.clearReconnectTimer();
      this.lastError = detail;
      this.connection = "close";
      this.setStatus(isLikelyLoginLost(detail) ? "awaiting_login" : "reconnecting");
      await this.destroyClient(false);

      if (!this.shouldReconnect()) {
        return this.getStatus();
      }

      await sleep(Math.min(this.config.reconnectDelayMs, 1500));
      await this.ensureClient();
      return this.getStatus();
    })()
      .catch((error) => {
        this.lastError = error.message;
        logger.error("Failed to recover WhatsApp client", {
          trigger,
          reason: detail,
          error: error.message
        });
        if (this.shouldReconnect()) {
          this.scheduleReconnect();
        }
        return this.getStatus();
      })
      .finally(() => {
        this.recoveryPromise = null;
      });

    return await this.recoveryPromise;
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
        if (isLikelyRuntimeContextError(error.message)) {
          void this.recoverClient("send_failure", { reason: error.message });
        }
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
      if (isLikelyRuntimeContextError(error.message)) {
        void this.recoverClient("refresh_chats_failure", { reason: error.message });
      }
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
    if (this.cleanupPromise) {
      await this.cleanupPromise;
    }

    this.stopHealthChecks();
    this.clearReconnectTimer();
    const client = this.client;
    this.client = null;
    await this.cleanupClientResources(client);

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
    this.consecutiveHealthFailures = 0;
    this.lastWaState = null;
    this.discoveredChats.clear();
    this.scheduleDiscoveryPersist();
  }

  setStatus(status) {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  async cleanupDisconnectedClient(client) {
    this.cleanupPromise = this.cleanupClientResources(client);

    try {
      await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }

  async cleanupClientResources(client) {
    this.stopHealthChecks();

    if (client) {
      try {
        client.__supplyConsoleDestroying = true;
        await client.destroy();
      } catch (error) {
        logger.warn("Failed to destroy WhatsApp client cleanly.", {
          error: error.message
        });
      }
    }

    await this.forceKillSessionBrowsers();
    await this.cleanupSessionLocks();
  }

  async ensureSessionBrowserStopped() {
    await this.forceKillSessionBrowsers();
    await this.cleanupSessionLocks();
    await sleep(350);
    await fs.mkdir(this.config.sessionDataDir, { recursive: true });
  }

  async cleanupSessionLocks() {
    const staticLockFiles = [
      "SingletonLock",
      "SingletonSocket",
      "SingletonCookie",
      "DevToolsActivePort"
    ];
    const lockPatterns = [/^\.org\.chromium\.Chromium\./, /^\.com\.google\.Chrome\./];

    await Promise.allSettled(
      staticLockFiles.map(async (name) => {
        await fs.rm(path.join(this.config.sessionDataDir, name), {
          recursive: true,
          force: true
        });
      })
    );

    try {
      const entries = await fs.readdir(this.config.sessionDataDir);
      await Promise.allSettled(
        entries
          .filter((name) => lockPatterns.some((pattern) => pattern.test(name)))
          .map(async (name) => {
            await fs.rm(path.join(this.config.sessionDataDir, name), {
              recursive: true,
              force: true
            });
          })
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn("Failed to clean WhatsApp session lock files.", {
          error: error.message
        });
      }
    }
  }

  async forceKillSessionBrowsers() {
    const marker = `--user-data-dir=${this.config.sessionDataDir}`;
    const pgrep = spawnSync("pgrep", ["-f", marker], {
      encoding: "utf8"
    });

    if (pgrep.status !== 0 || !pgrep.stdout.trim()) {
      return;
    }

    const pids = pgrep.stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        logger.warn("Failed to kill stale WhatsApp browser process.", {
          pid,
          error: error.message
        });
      }
    }
  }
}
