import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function buildKey(secret) {
  return createHash("sha256").update(String(secret)).digest();
}

export class SecureSessionStore {
  constructor({ filePath, secret = "" }) {
    this.filePath = filePath;
    this.secret = secret;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object") {
        return "";
      }

      if (!payload.encrypted) {
        return String(payload.data || "");
      }

      if (!this.secret) {
        throw new Error("Telegram session file is encrypted, but TELEGRAM_SESSION_SECRET is missing.");
      }

      const decipher = createDecipheriv(
        "aes-256-gcm",
        buildKey(this.secret),
        Buffer.from(payload.iv, "base64")
      );
      decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.data, "base64")),
        decipher.final()
      ]);
      return decrypted.toString("utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  async save(sessionString) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const payload = this.secret
      ? this.encrypt(String(sessionString || ""))
      : {
          version: 1,
          encrypted: false,
          updatedAt: new Date().toISOString(),
          data: String(sessionString || "")
        };

    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  async clear() {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  encrypt(sessionString) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", buildKey(this.secret), iv);
    const encrypted = Buffer.concat([cipher.update(sessionString, "utf8"), cipher.final()]);

    return {
      version: 1,
      encrypted: true,
      updatedAt: new Date().toISOString(),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64")
    };
  }
}
