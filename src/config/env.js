import dotenv from "dotenv";

dotenv.config();

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

function booleanFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: numberFromEnv("PORT", 3000),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  store: {
    stateFile: process.env.STORE_STATE_FILE || ".data/console-state.json",
    autosaveDebounceMs: numberFromEnv("STORE_AUTOSAVE_DEBOUNCE_MS", 150)
  },
  whatsapp: {
    authDir: process.env.WHATSAPP_AUTH_DIR || ".sessions/whatsapp-baileys",
    clientId: process.env.WHATSAPP_CLIENT_ID || "primary",
    browserName: process.env.WHATSAPP_BROWSER_NAME || "SupplyConsolePro",
    browserPath: process.env.WHATSAPP_BROWSER_PATH || "",
    headless: booleanFromEnv("WHATSAPP_HEADLESS", true),
    defaultPairingPhoneNumber: process.env.WHATSAPP_DEFAULT_PAIRING_PHONE || "",
    printQrInTerminal: booleanFromEnv("WHATSAPP_PRINT_QR", true),
    jitterMinMs: numberFromEnv("WHATSAPP_JITTER_MIN_MS", 500),
    jitterMaxMs: numberFromEnv("WHATSAPP_JITTER_MAX_MS", 1500),
    maxQueueSize: numberFromEnv("WHATSAPP_MAX_QUEUE_SIZE", 100),
    breakerFailureThreshold: numberFromEnv("WHATSAPP_BREAKER_FAILURE_THRESHOLD", 5),
    breakerCooldownMs: numberFromEnv("WHATSAPP_BREAKER_COOLDOWN_MS", 30000),
    reconnectDelayMs: numberFromEnv("WHATSAPP_RECONNECT_DELAY_MS", 3000),
    maxReconnectAttempts: numberFromEnv("WHATSAPP_MAX_RECONNECT_ATTEMPTS", 0),
    discoveryFile: process.env.WHATSAPP_DISCOVERY_FILE || "",
    discoveryAutosaveDebounceMs: numberFromEnv("WHATSAPP_DISCOVERY_AUTOSAVE_DEBOUNCE_MS", 200)
  },
  telegram: {
    apiId: numberFromEnv("TELEGRAM_API_ID", 0),
    apiHash: process.env.TELEGRAM_API_HASH || "",
    sessionFile: process.env.TELEGRAM_SESSION_FILE || ".sessions/telegram-userbot.json",
    sessionSecret: process.env.TELEGRAM_SESSION_SECRET || ""
  }
};

export function assertNodeVersion() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) {
    throw new Error("Node.js 18+ is required.");
  }
}
