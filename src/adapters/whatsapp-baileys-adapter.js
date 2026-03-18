import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  extractMessageContent,
  getContentType,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { logger } from "../lib/logger.js";

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

function normalizeJid(value) {
  const jid = String(value || "").trim();
  if (!jid) return "";
  if (jid.includes("@")) return jid;
  const digits = cleanPhoneNumber(jid);
  return digits ? `${digits}@s.whatsapp.net` : jid;
}

function displayNameFromJid(jid) {
  if (!jid) return "";
  if (jid.endsWith("@g.us")) {
    return `群组 ${jid.replace(/@g\.us$/, "")}`;
  }
  return cleanPhoneNumber(jid) || jid;
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    id: user.id || "",
    lid: user.lid || "",
    name: user.name || user.verifiedName || user.notify || "",
    phone: user.phone || ""
  };
}

function extractText(message) {
  const content = extractMessageContent(message?.message);
  const type = getContentType(content);
  if (!content || !type) {
    return "";
  }

  switch (type) {
    case "conversation":
      return content.conversation || "";
    case "extendedTextMessage":
      return content.extendedTextMessage?.text || "";
    case "imageMessage":
      return content.imageMessage?.caption || "";
    case "videoMessage":
      return content.videoMessage?.caption || "";
    case "documentMessage":
      return content.documentMessage?.caption || "";
    default:
      return "";
  }
}

function statusCodeFromDisconnect(error) {
  return error?.output?.statusCode || error?.data?.statusCode || null;
}

export class WhatsAppBaileysAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      ...config,
      authDir: path.resolve(config.authDir),
      discoveryFile: path.resolve(config.discoveryFile || path.join(config.authDir, "_discovered-chats.json")),
      maxQueueSize: Number(config.maxQueueSize) || 100,
      jitterMinMs: Number(config.jitterMinMs) || 500,
      jitterMaxMs: Number(config.jitterMaxMs) || 1500,
      reconnectDelayMs: Number(config.reconnectDelayMs) || 3000,
      maxReconnectAttempts: Number(config.maxReconnectAttempts) || 0,
      breakerFailureThreshold: Number(config.breakerFailureThreshold) || 5,
      breakerCooldownMs: Number(config.breakerCooldownMs) || 30000,
      discoveryAutosaveDebounceMs: Number(config.discoveryAutosaveDebounceMs) || 200
    };
    this.sock = null;
    this.status = "idle";
    this.connection = "close";
    this.user = null;
    this.qr = null;
    this.pairingCode = null;
    this.lastError = null;
    this.lastDisconnectCode = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pendingSocketSetup = null;
    this.shouldRun = true;
    this.queue = [];
    this.isProcessingQueue = false;
    this.consecutiveFailures = 0;
    this.circuitOpenedUntil = 0;
    this.ignoredSockets = new WeakSet();
    this.discoveredChats = new Map();
    this.contacts = new Map();
    this.discoveryPersistTimer = null;
    this.discoveryPersistPromise = null;
  }

  isConfigured() {
    return Boolean(this.config.authDir);
  }

  isReady() {
    return this.connection === "open" && Boolean(this.sock);
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      status: this.status,
      connection: this.connection,
      authenticated: Boolean(this.sock?.authState?.creds?.registered),
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
    const { state } = await useMultiFileAuthState(this.config.authDir);
    if (state.creds.registered) {
      await this.ensureSocket();
    } else {
      this.setStatus("awaiting_login");
    }
    return this.getStatus();
  }

  async connect({ mode = "qr", phoneNumber } = {}) {
    if (!this.isConfigured()) {
      throw new Error("WhatsApp Baileys auth directory is not configured.");
    }

    this.shouldRun = true;
    const sock = await this.ensureSocket();

    if (mode === "pairing_code") {
      if (sock.authState.creds.registered) {
        return this.getStatus();
      }

      const normalizedPhone = cleanPhoneNumber(phoneNumber || this.config.defaultPairingPhoneNumber);
      if (!normalizedPhone) {
        throw new Error("phoneNumber is required for pairing_code mode.");
      }

      this.pairingCode = await sock.requestPairingCode(normalizedPhone);
      this.qr = null;
      this.setStatus("awaiting_pairing_code");
      logger.info("WhatsApp pairing code generated");
    }

    return this.getStatus();
  }

  async reconnect() {
    this.shouldRun = true;
    await this.ensureSocket(true);
    return this.getStatus();
  }

  async logout() {
    this.shouldRun = false;
    this.clearReconnectTimer();

    if (this.sock) {
      this.ignoredSockets.add(this.sock);
      try {
        await this.sock.logout("Manual logout from Supply Console");
      } catch (error) {
        logger.warn("WhatsApp logout failed, clearing auth dir locally.", {
          error: error.message
        });
      }
    }

    this.sock = null;
    await fs.rm(this.config.authDir, { recursive: true, force: true });
    await fs.mkdir(this.config.authDir, { recursive: true });
    this.resetVolatileState();
    this.setStatus("awaiting_login");
    logger.info("WhatsApp Baileys session cleared");
    return this.getStatus();
  }

  async sendText({ to, previewLabel, text }) {
    const jid = normalizeJid(to);
    if (!jid) {
      logger.warn("WhatsApp target jid missing. Falling back to dry-run.", { previewLabel });
      return {
        dryRun: true,
        reason: "missing_jid",
        platform: "whatsapp",
        previewLabel,
        text
      };
    }

    if (!this.isReady()) {
      logger.warn("WhatsApp socket is not ready yet. Falling back to dry-run.", {
        previewLabel,
        status: this.status
      });
      return {
        dryRun: true,
        reason: "socket_not_ready",
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
        jid,
        text,
        previewLabel,
        resolve,
        reject
      });
      void this.processQueue();
    });
  }

  async ensureSocket(force = false) {
    if (this.pendingSocketSetup && !force) {
      return await this.pendingSocketSetup;
    }

    if (this.sock && !force) {
      return this.sock;
    }

    this.pendingSocketSetup = this.buildSocket(force);
    try {
      return await this.pendingSocketSetup;
    } finally {
      this.pendingSocketSetup = null;
    }
  }

  async buildSocket(force) {
    if (force && this.sock) {
      this.ignoredSockets.add(this.sock);
      try {
        this.sock.end(new Error("Intentional WhatsApp socket restart"));
      } catch (error) {
        logger.warn("Failed to end stale WhatsApp socket during restart.", {
          error: error.message
        });
      }
      this.sock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu(this.config.browserName || "SupplyConsolePro"),
      markOnlineOnConnect: false,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false
    });

    this.sock = sock;
    this.connection = "connecting";
    this.setStatus(state.creds.registered ? "connecting" : "awaiting_login");

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(sock, update);
    });
    sock.ev.on("messaging-history.set", (event) => {
      this.handleHistorySet(event);
    });
    sock.ev.on("chats.upsert", (chats) => {
      this.handleChatsUpsert(chats);
    });
    sock.ev.on("contacts.upsert", (contacts) => {
      this.handleContactsUpsert(contacts);
    });
    sock.ev.on("contacts.update", (contacts) => {
      this.handleContactsUpsert(contacts);
    });
    sock.ev.on("messages.upsert", (event) => {
      void this.handleMessagesUpsert(sock, event);
    });

    return sock;
  }

  async handleConnectionUpdate(sock, update) {
    if (this.ignoredSockets.has(sock)) {
      return;
    }

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qr = qr;
      this.pairingCode = null;
      this.lastError = null;
      this.setStatus("awaiting_scan");

      if (this.config.printQrInTerminal) {
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === "connecting") {
      this.connection = "connecting";
      this.setStatus(this.sock?.authState?.creds?.registered ? "connecting" : "awaiting_login");
      return;
    }

    if (connection === "open") {
      this.connection = "open";
      this.qr = null;
      this.pairingCode = null;
      this.lastError = null;
      this.lastDisconnectCode = null;
      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;
      this.circuitOpenedUntil = 0;
      this.user = normalizeUser(sock.user);
      this.setStatus("ready");
      logger.info("WhatsApp Baileys socket connected", {
        userId: this.user?.id || ""
      });
      return;
    }

    if (connection === "close") {
      this.connection = "close";
      this.sock = sock === this.sock ? null : this.sock;
      this.lastDisconnectCode = statusCodeFromDisconnect(lastDisconnect?.error);
      this.lastError = lastDisconnect?.error?.message || "WhatsApp socket closed";

      const shouldReconnect = this.shouldReconnect(this.lastDisconnectCode);
      this.setStatus(shouldReconnect ? "reconnecting" : "closed");

      logger.warn("WhatsApp Baileys socket closed", {
        reason: this.lastError,
        statusCode: this.lastDisconnectCode,
        shouldReconnect
      });

      if (!shouldReconnect) {
        if (
          this.lastDisconnectCode === DisconnectReason.loggedOut ||
          this.lastDisconnectCode === DisconnectReason.badSession
        ) {
          await fs.rm(this.config.authDir, { recursive: true, force: true });
          await fs.mkdir(this.config.authDir, { recursive: true });
          this.qr = null;
          this.pairingCode = null;
          this.user = null;
          this.setStatus("awaiting_login");
        }
        return;
      }

      this.scheduleReconnect();
    }
  }

  async handleMessagesUpsert(sock, event) {
    if (this.ignoredSockets.has(sock)) {
      return;
    }

    for (const message of event.messages) {
      const remoteJid = message.key.remoteJid || "";
      if (!remoteJid || remoteJid === "status@broadcast") {
        continue;
      }

      const text = extractText(message);
      this.upsertDiscoveredChat({
        remoteId: remoteJid,
        title: message.pushName || "",
        lastMessageAt: lastActivityToIso(message.messageTimestamp),
        isGroup: remoteJid.endsWith("@g.us"),
        previewText: text,
        source: message.key.fromMe ? "message_echo" : "message_inbound"
      });

      if (message.key.fromMe || event.type !== "notify") {
        continue;
      }

      this.emit("message", {
        id: message.key.id || "",
        chatId: remoteJid,
        participant: message.key.participant || "",
        text,
        timestamp: message.messageTimestamp ? Number(message.messageTimestamp) : Date.now() / 1000,
        isGroup: remoteJid.endsWith("@g.us")
      });
    }
  }

  handleHistorySet(event) {
    this.handleContactsUpsert(event?.contacts || []);
    this.handleChatsUpsert(event?.chats || []);

    for (const message of event?.messages || []) {
      const remoteJid = message?.key?.remoteJid || "";
      if (!remoteJid || remoteJid === "status@broadcast") {
        continue;
      }

      this.upsertDiscoveredChat({
        remoteId: remoteJid,
        title: message.pushName || "",
        lastMessageAt: lastActivityToIso(message.messageTimestamp),
        isGroup: remoteJid.endsWith("@g.us"),
        previewText: extractText(message),
        source: "history_sync"
      });
    }
  }

  handleChatsUpsert(chats) {
    for (const chat of chats || []) {
      const remoteId = normalizeJid(chat?.id);
      if (!remoteId || remoteId === "status@broadcast") {
        continue;
      }

      this.upsertDiscoveredChat({
        remoteId,
        title: chat?.name || chat?.pushName || "",
        lastMessageAt: lastActivityToIso(chat?.conversationTimestamp || chat?.lastMessageRecvTimestamp),
        isGroup: remoteId.endsWith("@g.us"),
        source: "chat_sync"
      });
    }
  }

  handleContactsUpsert(contacts) {
    for (const contact of contacts || []) {
      const remoteId = normalizeJid(contact?.id || contact?.phoneNumber);
      if (!remoteId || remoteId === "status@broadcast") {
        continue;
      }

      const current = this.contacts.get(remoteId) || {};
      this.contacts.set(remoteId, {
        remoteId,
        title: contact?.name || contact?.verifiedName || contact?.notify || current.title || "",
        phone: cleanPhoneNumber(contact?.phoneNumber || current.phone || remoteId)
      });

      this.upsertDiscoveredChat({
        remoteId,
        title: contact?.name || contact?.verifiedName || contact?.notify || "",
        phone: contact?.phoneNumber || current.phone || "",
        isGroup: remoteId.endsWith("@g.us"),
        source: "contact_sync"
      });
    }
  }

  upsertDiscoveredChat(entry) {
    const remoteId = normalizeJid(entry?.remoteId);
    if (!remoteId || remoteId === "status@broadcast") {
      return;
    }

    const previous = this.discoveredChats.get(remoteId) || {};
    const contact = this.contacts.get(remoteId) || {};
    const normalized = {
      remoteId,
      platform: "whatsapp",
      title: entry?.title || contact.title || previous.title || displayNameFromJid(remoteId),
      phone: cleanPhoneNumber(entry?.phone || contact.phone || previous.phone || remoteId),
      type: entry?.isGroup || remoteId.endsWith("@g.us") ? "group" : "private",
      lastMessageAt: entry?.lastMessageAt || previous.lastMessageAt || null,
      previewText: entry?.previewText || previous.previewText || "",
      source: entry?.source || previous.source || ""
    };

    this.discoveredChats.set(remoteId, normalized);
    this.scheduleDiscoveryPersist();

    if (this.discoveredChats.size > 300) {
      const stale = [...this.discoveredChats.values()]
        .sort((left, right) => {
          const leftTs = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
          const rightTs = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
          return rightTs - leftTs;
        })
        .slice(250);

      for (const item of stale) {
        this.discoveredChats.delete(item.remoteId);
      }
    }
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
        label: chat.title || displayNameFromJid(chat.remoteId)
      }));
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

  shouldReconnect(statusCode) {
    if (!this.shouldRun) {
      return false;
    }

    return ![
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.connectionReplaced,
      DisconnectReason.multideviceMismatch,
      DisconnectReason.forbidden
    ].includes(statusCode);
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
      void this.ensureSocket(true).catch((error) => {
        this.lastError = error.message;
        this.setStatus("error");
        logger.error("Failed to reconnect WhatsApp socket", { error: error.message });
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
        const jitterMs = randomBetween(this.config.jitterMinMs, this.config.jitterMaxMs);
        await this.sock.sendPresenceUpdate("composing", task.jid);
        await sleep(jitterMs);

        const payload = await this.sock.sendMessage(task.jid, { text: task.text });
        this.upsertDiscoveredChat({
          remoteId: task.jid,
          title: task.previewLabel,
          lastMessageAt: new Date().toISOString(),
          source: "outbound_send"
        });

        await this.sock.sendPresenceUpdate("paused", task.jid).catch(() => {});
        this.recordSendSuccess();

        task.resolve({
          dryRun: false,
          platform: "whatsapp",
          jid: task.jid,
          messageId: payload?.key?.id || null,
          delayMs: jitterMs
        });
      } catch (error) {
        this.recordSendFailure(error);
        task.reject(error);
      }
    }

    this.isProcessingQueue = false;
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
    this.contacts.clear();
    this.scheduleDiscoveryPersist();
  }

  setStatus(status) {
    this.status = status;
    this.emit("status", this.getStatus());
  }
}
