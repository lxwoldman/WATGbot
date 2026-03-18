import path from "node:path";
import { EventEmitter } from "node:events";
import bigInt from "big-integer";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { logger } from "../lib/logger.js";
import { SecureSessionStore } from "../lib/secure-session-store.js";

function maskPhone(phoneNumber) {
  const value = String(phoneNumber || "");
  if (value.length <= 4) return value;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function toEntityLike(chatId) {
  const value = String(chatId || "").trim();
  if (/^-?\d+$/.test(value)) {
    return bigInt(value);
  }
  return value;
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    id: user.id ? String(user.id) : "",
    username: user.username || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    phone: user.phone || ""
  };
}

function dialogTypeFromDialog(dialog) {
  if (dialog?.isGroup) return "group";
  if (dialog?.isChannel) return "channel";
  return "private";
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date((numeric > 10_000_000_000 ? numeric : numeric * 1000)).toISOString();
}

export class TelegramUserbotAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.authorizedUser = null;
    this.pendingLogin = null;
    this.status = "idle";
    this.lastError = null;
    this.messageHandler = (event) => {
      void this.handleIncomingMessage(event);
    };
    this.sessionStore = new SecureSessionStore({
      filePath: path.resolve(config.sessionFile),
      secret: config.sessionSecret
    });
  }

  isConfigured() {
    return Number(this.config.apiId) > 0 && Boolean(this.config.apiHash);
  }

  isAuthorized() {
    return Boolean(this.client && this.authorizedUser);
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      status: this.status,
      authorized: this.isAuthorized(),
      user: this.authorizedUser,
      pendingLogin: this.pendingLogin
        ? {
            phoneNumberMasked: maskPhone(this.pendingLogin.phoneNumber),
            isCodeViaApp: this.pendingLogin.isCodeViaApp,
            passwordRequired: this.pendingLogin.passwordRequired,
            requestedAt: this.pendingLogin.requestedAt
          }
        : null,
      lastError: this.lastError,
      sessionFile: this.sessionStore.filePath
    };
  }

  async initialize() {
    if (!this.isConfigured()) {
      logger.warn("Telegram UserBot credentials are missing. Adapter will stay in dry-run mode.");
      this.setStatus("missing_config");
      return this.getStatus();
    }

    try {
      const savedSession = await this.sessionStore.load();
      if (!savedSession) {
        this.setStatus("awaiting_login");
        return this.getStatus();
      }

      const client = this.createClient(savedSession);
      await client.connect();

      if (!(await client.checkAuthorization())) {
        await client.disconnect();
        await this.sessionStore.clear();
        this.setStatus("awaiting_login");
        return this.getStatus();
      }

      this.client = client;
      return await this.finishAuthorizedSession("restored_session");
    } catch (error) {
      this.lastError = error.message;
      this.setStatus("error");
      logger.error("Failed to initialize Telegram UserBot adapter", { error: error.message });
      await this.disconnectClient();
      return this.getStatus();
    }
  }

  async requestLoginCode({ phoneNumber, forceSms = false } = {}) {
    if (!this.isConfigured()) {
      throw new Error("Telegram API credentials are missing. Please set TELEGRAM_API_ID and TELEGRAM_API_HASH.");
    }

    if (this.isAuthorized()) {
      return this.getStatus();
    }

    const normalizedPhone = String(phoneNumber || "").trim();
    if (!normalizedPhone) {
      throw new Error("phoneNumber is required.");
    }

    await this.disconnectClient();

    const client = this.createClient("");
    await client.connect();
    const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
      this.getApiCredentials(),
      normalizedPhone,
      forceSms
    );

    this.client = client;
    this.pendingLogin = {
      phoneNumber: normalizedPhone,
      phoneCodeHash,
      isCodeViaApp,
      passwordRequired: false,
      requestedAt: new Date().toISOString()
    };
    this.lastError = null;
    this.setStatus("code_sent");
    logger.info("Telegram login code requested", {
      phoneNumberMasked: maskPhone(normalizedPhone),
      isCodeViaApp
    });
    return this.getStatus();
  }

  async completeLogin({ phoneCode, password } = {}) {
    if (this.isAuthorized()) {
      return this.getStatus();
    }

    if (!this.client || !this.pendingLogin) {
      throw new Error("No pending Telegram login request. Call request-code first.");
    }

    if (this.pendingLogin.passwordRequired) {
      if (!password) {
        throw new Error("password is required because this account has 2FA enabled.");
      }
      await this.signInWithPassword(password);
      return await this.finishAuthorizedSession("password_login");
    }

    const normalizedCode = String(phoneCode || "").trim();
    if (!normalizedCode) {
      throw new Error("phoneCode is required.");
    }

    try {
      const result = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.pendingLogin.phoneNumber,
          phoneCodeHash: this.pendingLogin.phoneCodeHash,
          phoneCode: normalizedCode
        })
      );

      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new Error("This phone number is not linked to an existing Telegram account.");
      }

      return await this.finishAuthorizedSession("code_login");
    } catch (error) {
      if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        this.pendingLogin.passwordRequired = true;
        this.setStatus("password_required");

        if (!password) {
          return this.getStatus();
        }

        await this.signInWithPassword(password);
        return await this.finishAuthorizedSession("password_login");
      }

      this.lastError = error.message;
      logger.error("Telegram login failed", { error: error.message });
      throw error;
    }
  }

  async logout() {
    if (this.client && this.isAuthorized()) {
      try {
        await this.client.invoke(new Api.auth.LogOut());
      } catch (error) {
        logger.warn("Telegram logout request failed, clearing local session anyway.", {
          error: error.message
        });
      }
    }

    await this.disconnectClient();
    await this.sessionStore.clear();
    this.authorizedUser = null;
    this.pendingLogin = null;
    this.lastError = null;
    this.setStatus(this.isConfigured() ? "awaiting_login" : "missing_config");
    logger.info("Telegram UserBot session cleared");
    return this.getStatus();
  }

  async sendText({ chatId, previewLabel, text }) {
    if (!this.isConfigured()) {
      logger.warn("Telegram UserBot credentials are missing. Falling back to dry-run.", { previewLabel });
      return {
        dryRun: true,
        reason: "missing_api_credentials",
        platform: "telegram",
        previewLabel,
        text
      };
    }

    if (!chatId) {
      logger.warn("Telegram resource is missing chatId. Falling back to dry-run.", { previewLabel });
      return {
        dryRun: true,
        reason: "missing_chat_id",
        platform: "telegram",
        previewLabel,
        text
      };
    }

    if (!this.isAuthorized()) {
      logger.warn("Telegram UserBot is not authorized yet. Falling back to dry-run.", { previewLabel });
      return {
        dryRun: true,
        reason: "userbot_not_authorized",
        platform: "telegram",
        previewLabel,
        text
      };
    }

    try {
      const message = await this.client.sendMessage(toEntityLike(chatId), { message: text });
      return {
        dryRun: false,
        platform: "telegram",
        chatId: String(chatId),
        messageId: message?.id || null,
        text
      };
    } catch (error) {
      logger.error("Telegram UserBot send failed", {
        previewLabel,
        chatId: String(chatId),
        error: error.errorMessage || error.message
      });
      throw new Error(error.errorMessage || error.message || "Telegram UserBot send failed.");
    }
  }

  async listDialogs(limit = 50) {
    if (!this.isAuthorized()) {
      return [];
    }

    const dialogs = await this.client.getDialogs({ limit: Math.max(1, Number(limit) || 50) });
    return dialogs.map((dialog) => {
      const entity = dialog.entity;
      const remoteId = dialog.id ? dialog.id.toString() : "";
      const title = dialog.title || dialog.name || entity?.title || entity?.firstName || entity?.username || remoteId;
      return {
        platform: "telegram",
        remoteId,
        label: title,
        title,
        type: dialogTypeFromDialog(dialog),
        username: entity?.username || "",
        phone: entity?.phone || "",
        lastMessageAt: toIsoDate(dialog.date)
      };
    });
  }

  createClient(sessionString) {
    return new TelegramClient(new StringSession(sessionString), Number(this.config.apiId), this.config.apiHash, {
      connectionRetries: 5,
      deviceModel: "SupplyConsolePro",
      appVersion: "0.1.0"
    });
  }

  getApiCredentials() {
    return {
      apiId: Number(this.config.apiId),
      apiHash: this.config.apiHash
    };
  }

  async signInWithPassword(password) {
    await this.client.signInWithPassword(this.getApiCredentials(), {
      password: async () => String(password),
      onError: (error) => {
        throw error;
      }
    });
  }

  async finishAuthorizedSession(reason) {
    const me = await this.client.getMe();
    this.authorizedUser = normalizeUser(me);
    this.pendingLogin = null;
    this.lastError = null;
    this.attachEventHandler();
    await this.sessionStore.save(this.client.session.save());
    this.setStatus("ready");
    logger.info("Telegram UserBot is ready", { reason, userId: this.authorizedUser?.id || "" });
    return this.getStatus();
  }

  attachEventHandler() {
    if (!this.client) return;
    this.client.addEventHandler(this.messageHandler, new NewMessage({ incoming: true }));
  }

  async disconnectClient() {
    if (!this.client) return;
    try {
      await this.client.disconnect();
    } catch (error) {
      logger.warn("Telegram client disconnect failed", { error: error.message });
    } finally {
      this.client = null;
    }
  }

  async handleIncomingMessage(event) {
    try {
      const message = event?.message;
      if (!message) return;

      this.emit("message", {
        id: String(message.id),
        chatId: message.chatId ? message.chatId.toString() : "",
        senderId: message.senderId ? message.senderId.toString() : "",
        text: message.message || "",
        date: new Date(Number(message.date || 0) * 1000).toISOString(),
        isPrivate: Boolean(message.isPrivate),
        isGroup: Boolean(message.isGroup)
      });
    } catch (error) {
      logger.warn("Failed to normalize Telegram inbound message", { error: error.message });
    }
  }

  setStatus(status) {
    this.status = status;
    this.emit("status", this.getStatus());
  }
}
