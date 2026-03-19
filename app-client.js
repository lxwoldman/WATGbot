const supplierQuickReplies = ["0 (已阅)", "1 (就位)", "2 (出货完毕)"];

const defaultCustomCommands = [
  { id: "wait", label: "等等", text: "等等" },
  { id: "resume", label: "恢复", text: "恢复" },
  { id: "cancel", label: "取消", text: "取消" },
  { id: "urge", label: "催单", text: "好了吗" }
];

const defaultConsoleSettings = {
  exchangeRate: 7,
  specialTarget: 20000,
  followAmount: 5000,
  manualAmericas: false,
  customCommands: defaultCustomCommands
};

const defaultCommandById = Object.fromEntries(
  defaultCustomCommands.map((item) => [item.id, item])
);

const storageKeys = {
  customCommands: "broker-console.custom-commands.v1",
  resourceCurrencies: "broker-console.resource-currencies.v1",
  exchangeRate: "broker-console.exchange-rate.v1",
  specialTarget: "broker-console.special-target.v1",
  followAmount: "broker-console.follow-amount.v1",
  manualAmericas: "broker-console.manual-americas.v1",
  stableTicket: "broker-console.stable-ticket.v1"
};

const americasKeywords = [
  "阿根廷",
  "安提瓜和巴布达",
  "巴巴多斯",
  "巴哈马",
  "巴拉圭",
  "巴拿马",
  "巴西",
  "秘鲁",
  "玻利维亚",
  "多米尼加",
  "多米尼克",
  "厄瓜多尔",
  "哥伦比亚",
  "委内瑞拉",
  "哥斯黎达加",
  "哥斯达黎加",
  "格林纳达",
  "古巴",
  "海地",
  "洪都拉斯",
  "加拿大",
  "美国",
  "墨西哥",
  "萨尔瓦多",
  "圣卢西亚",
  "圣文森特和格林纳丁斯",
  "圣基茨和尼维斯",
  "苏里南",
  "特立尼达和多巴哥",
  "危地马拉",
  "乌拉圭",
  "牙买加",
  "智利",
  "圭亚那",
  "伯利兹"
];

function safeParseJson(rawValue, fallback) {
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallback;
  }
}

function loadJson(key, fallback) {
  return safeParseJson(window.localStorage.getItem(key), fallback);
}

function saveJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadNumber(key, fallback) {
  const rawValue = window.localStorage.getItem(key);
  if (rawValue == null || rawValue === "") return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function saveNumber(key, value) {
  window.localStorage.setItem(key, String(value));
}

function loadBoolean(key, fallback = false) {
  const rawValue = window.localStorage.getItem(key);
  if (rawValue == null) return fallback;
  return rawValue === "true";
}

function saveBoolean(key, value) {
  window.localStorage.setItem(key, value ? "true" : "false");
}

function roundToTwo(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return roundToTwo(value).toFixed(2);
}

function makeId(prefix = "cmd") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveCommandLabel(text) {
  const normalized = String(text || "")
    .split("\n")[0]
    .split("/")[0]
    .trim();

  if (!normalized) return "新指令";
  if (normalized.includes("请尽快回执")) return "催单";
  return normalized.length > 8 ? `${normalized.slice(0, 8)}...` : normalized;
}

function normalizeCommand(command, index = 0) {
  const fallback = defaultCommandById[command?.id] || null;
  let text = String(command?.text ?? command ?? "").trim();
  let label = String(command?.label || "").trim();

  if (fallback) {
    if (text.length <= 1) {
      text = fallback.text;
    }
    if (label.length <= 1) {
      label = fallback.label;
    }
  }

  return {
    id: String(command?.id || makeId(`cmd-${index}`)),
    label: label || deriveCommandLabel(text) || `指令 ${index + 1}`,
    text
  };
}

function loadCustomCommands() {
  const saved = loadJson(storageKeys.customCommands, defaultCustomCommands);
  const normalized = Array.isArray(saved)
    ? saved.map((item, index) => normalizeCommand(item, index)).filter((item) => item.text)
    : [];

  return normalized.length ? normalized : defaultCustomCommands.map((item, index) => normalizeCommand(item, index));
}

const legacySharedSettings = {
  customCommands: loadCustomCommands(),
  resourceCurrencies: loadJson(storageKeys.resourceCurrencies, {}),
  exchangeRate: loadNumber(storageKeys.exchangeRate, defaultConsoleSettings.exchangeRate),
  specialTarget: loadNumber(storageKeys.specialTarget, defaultConsoleSettings.specialTarget),
  followAmount: loadNumber(storageKeys.followAmount, defaultConsoleSettings.followAmount),
  manualAmericas: loadBoolean(storageKeys.manualAmericas, defaultConsoleSettings.manualAmericas)
};

const state = {
  snapshot: null,
  selectedSourceId: null,
  selectedReceiptResourceId: null,
  selectedRecentChatKey: "",
  recentChats: [],
  resourceSyncTimers: {},
  lastSourceFingerprint: "",
  latestFeedbackPrice: "",
  latestSupplierRepriceText: "",
  customCommands: defaultCustomCommands.map((item, index) => normalizeCommand(item, index)),
  resourceCurrencies: { ...legacySharedSettings.resourceCurrencies },
  exchangeRate: defaultConsoleSettings.exchangeRate,
  specialTarget: defaultConsoleSettings.specialTarget,
  followAmount: defaultConsoleSettings.followAmount,
  manualAmericas: defaultConsoleSettings.manualAmericas,
  lastStableTicket: loadJson(storageKeys.stableTicket, null),
  receiptOddsManual: false,
  sharedSettingsHydrated: false,
  legacySettingsMigrated: false,
  consoleSettingsUnsupportedNotified: false,
  integration: {
    whatsapp: null,
    telegram: null
  }
};

const socket = io();

const els = {
  sourceOnlineBadge: document.getElementById("sourceOnlineBadge"),
  sourceChannelSelect: document.getElementById("sourceChannelSelect"),
  sourceDeleteBtn: document.getElementById("sourceDeleteBtn"),
  sourceArrivedAt: document.getElementById("sourceArrivedAt"),
  sourceMessageText: document.getElementById("sourceMessageText"),
  extractMessageBtn: document.getElementById("extractMessageBtn"),
  quickReplyContainer: document.getElementById("quickReplyContainer"),
  supplierFeedbackBox: document.getElementById("supplierFeedbackBox"),
  supplierFeedbackText: document.getElementById("supplierFeedbackText"),
  supplierFeedbackBtn: document.getElementById("supplierFeedbackBtn"),
  ticketIdBadge: document.getElementById("ticketIdBadge"),
  inpLeague: document.getElementById("inpLeague"),
  inpTeam: document.getElementById("inpTeam"),
  inpMarket: document.getElementById("inpMarket"),
  oddsRaw: document.getElementById("oddsRaw"),
  oddsRebate: document.getElementById("oddsRebate"),
  oddsFinal: document.getElementById("oddsFinal"),
  targetTotal: document.getElementById("targetTotal"),
  specialTarget: document.getElementById("specialTarget"),
  followAmount: document.getElementById("followAmount"),
  exchangeRate: document.getElementById("exchangeRate"),
  americasOrderCheckbox: document.getElementById("americasOrderCheckbox"),
  targetAllocated: document.getElementById("targetAllocated"),
  effectiveTarget: document.getElementById("effectiveTarget"),
  targetGap: document.getElementById("targetGap"),
  targetHintText: document.getElementById("targetHintText"),
  gapBox: document.getElementById("gapBox"),
  sumConfirmed: document.getElementById("sumConfirmed"),
  corePrepBtn: document.getElementById("corePrepBtn"),
  coreMarketBtn: document.getElementById("coreMarketBtn"),
  customCommandContainer: document.getElementById("customCommandContainer"),
  commandManageBtn: document.getElementById("commandManageBtn"),
  commandModal: document.getElementById("commandModal"),
  commandModalCloseBtn: document.getElementById("commandModalCloseBtn"),
  commandEditorList: document.getElementById("commandEditorList"),
  commandAddBtn: document.getElementById("commandAddBtn"),
  commandSaveBtn: document.getElementById("commandSaveBtn"),
  resourceContainer: document.getElementById("resourceContainer"),
  resourceRepriceBox: document.getElementById("resourceRepriceBox"),
  resourceRepriceText: document.getElementById("resourceRepriceText"),
  resourceRepriceBtn: document.getElementById("resourceRepriceBtn"),
  recTarget: document.getElementById("recTarget"),
  recAmt: document.getElementById("recAmt"),
  recCount: document.getElementById("recCount"),
  recOdds: document.getElementById("recOdds"),
  recText: document.getElementById("recText"),
  receiptSendButton: document.getElementById("receiptSendButton"),
  receiptCopyButton: document.getElementById("receiptCopyButton"),
  opsGlobalBadge: document.getElementById("opsGlobalBadge"),
  waStatusBadge: document.getElementById("waStatusBadge"),
  waConnectQrBtn: document.getElementById("waConnectQrBtn"),
  waPairBtn: document.getElementById("waPairBtn"),
  waReconnectBtn: document.getElementById("waReconnectBtn"),
  waLogoutBtn: document.getElementById("waLogoutBtn"),
  waRefreshStatusBtn: document.getElementById("waRefreshStatusBtn"),
  waPairPhoneInput: document.getElementById("waPairPhoneInput"),
  waQrImage: document.getElementById("waQrImage"),
  waQrHint: document.getElementById("waQrHint"),
  waPairCode: document.getElementById("waPairCode"),
  waMetaText: document.getElementById("waMetaText"),
  tgStatusBadge: document.getElementById("tgStatusBadge"),
  tgPhoneInput: document.getElementById("tgPhoneInput"),
  tgCodeInput: document.getElementById("tgCodeInput"),
  tgPasswordInput: document.getElementById("tgPasswordInput"),
  tgRequestCodeBtn: document.getElementById("tgRequestCodeBtn"),
  tgLoginBtn: document.getElementById("tgLoginBtn"),
  tgLogoutBtn: document.getElementById("tgLogoutBtn"),
  tgRefreshStatusBtn: document.getElementById("tgRefreshStatusBtn"),
  tgMetaText: document.getElementById("tgMetaText"),
  bindScopeBadge: document.getElementById("bindScopeBadge"),
  bindRoleSelect: document.getElementById("bindRoleSelect"),
  bindPlatformSelect: document.getElementById("bindPlatformSelect"),
  bindRefreshBtn: document.getElementById("bindRefreshBtn"),
  bindApplyBtn: document.getElementById("bindApplyBtn"),
  bindDiscoverySelect: document.getElementById("bindDiscoverySelect"),
  bindSearchInput: document.getElementById("bindSearchInput"),
  bindNoteInput: document.getElementById("bindNoteInput"),
  bindMetaText: document.getElementById("bindMetaText"),
  copyMarketBtn: document.getElementById("copyMarketBtn"),
  buildSummaryBtn: document.getElementById("buildSummaryBtn"),
  toastStack: document.getElementById("toastStack")
};

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload.data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(text) {
  return String(text || "")
    .split("\n")
    .map((part) => escapeHtml(part))
    .join("<br>");
}

function setBadge(element, text, tone = "") {
  if (!element) return;
  element.textContent = text;
  element.className = `badge${tone ? ` ${tone}` : ""}`;
}

function setOpsStatus(text, tone = "") {
  setBadge(els.opsGlobalBadge, text, tone);
}

function showToast(text, tone = "") {
  if (!els.toastStack || !text) return;
  const toast = document.createElement("div");
  toast.className = `toast${tone ? ` ${tone}` : ""}`;
  toast.textContent = text;
  els.toastStack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function notify(text, tone = "", toast = false) {
  setOpsStatus(text, tone);
  if (toast) {
    showToast(text, tone);
  }
}

function getExchangeRateValue() {
  return Math.max(Number(els.exchangeRate.value || state.exchangeRate || 7), 0.01);
}

function getSpecialTargetValue() {
  return Math.max(Number(els.specialTarget.value || state.specialTarget || 0), 0);
}

function getFollowAmountValue() {
  return Math.max(Number(els.followAmount.value || state.followAmount || 0), 0);
}

function isAmericasLeague(text) {
  const league = String(text || "");
  return americasKeywords.some((keyword) => league.includes(keyword));
}

function isAmericasOrder() {
  return Boolean(els.americasOrderCheckbox.checked || isAmericasLeague(els.inpLeague.value));
}

function currentTicketPatch() {
  return {
    sourceChannelId: els.sourceChannelSelect.value,
    league: els.inpLeague.value.trim(),
    teams: els.inpTeam.value.trim(),
    marketText: els.inpMarket.value.trim(),
    rawOdds: Number(els.oddsRaw.value || 0),
    rebate: Number(els.oddsRebate.value || 0),
    deliveryTarget: Number(els.targetTotal.value || 0)
  };
}

function splitTextLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRawOdds(text) {
  const matches = [...String(text || "").matchAll(/[＠@]\s*([0-9]+(?:\.[0-9]+)?)/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}

function parseSourceMessage(text) {
  const lines = splitTextLines(text);

  if (!lines.length) {
    return {
      league: "",
      teams: "",
      marketText: "",
      rawOdds: ""
    };
  }

  let marketIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/@\s*[0-9]+(?:\.[0-9]+)?/.test(lines[index])) {
      marketIndex = index;
      break;
    }
  }

  let league = lines[0] || "";
  let teams = lines[1] || "";
  let marketLines = lines.slice(2);

  if (marketIndex >= 2) {
    league = lines[marketIndex - 2] || league;
    teams = lines[marketIndex - 1] || teams;
    marketLines = lines.slice(marketIndex);
  } else if (
    lines.length >= 4 &&
    /滚球|让球|大小|足球|篮球|网球|棒球|冰球/.test(lines[0])
  ) {
    league = lines[1] || league;
    teams = lines[2] || teams;
    marketLines = lines.slice(3);
  }

  const marketText = marketLines.join(" / ").trim();
  return {
    league,
    teams,
    marketText,
    rawOdds: parseRawOdds(marketText || text)
  };
}

function extractFeedbackSignal(text) {
  const rawText = String(text || "").trim();
  if (!rawText) return null;

  const lines = splitTextLines(rawText);
  const normalizedText = rawText.replace(/\s+/g, " ");
  const candidates = [];

  lines.forEach((line, lineIndex) => {
    const matches = [
      ...line.matchAll(/(^|[^\d.])((?:0|1)\.\d{1,3})(?:\s*(拿|收|了))?(?=$|[^\d])/g)
    ];

    matches.forEach((match, matchIndex) => {
      const price = match[2];
      const suffix = match[3] || "";
      const priceValue = Number(price);
      if (!(priceValue > 0 && priceValue < 2)) return;

      let score = 10 + lineIndex + matchIndex;
      if (suffix) score += 4;
      if (/^((?:0|1)\.\d{1,3})(?:\s*(拿|收|了))?$/.test(line)) score += 7;
      if (lines.length === 1) score += 3;
      if (normalizedText.length <= 12) score += 2;
      if (/[改回上收拿了]/.test(line)) score += 1;
      if (/[＠@/]/.test(line)) score -= 7;
      if (/联赛|滚球|让球|大小|角球|波胆|单双|盘口|预备|回执|回单|确\d|单号|金额/.test(line)) score -= 6;
      if (/\bv\b|\bvs\b/i.test(line)) score -= 5;
      if (lines.length >= 3 && /[＠@]/.test(normalizedText)) score -= 6;

      candidates.push({
        text: `${price}${suffix}`,
        price,
        score,
        lineIndex,
        matchIndex
      });
    });
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.lineIndex !== left.lineIndex) return right.lineIndex - left.lineIndex;
    return right.matchIndex - left.matchIndex;
  });

  return candidates[0] && candidates[0].score >= 7 ? candidates[0] : null;
}

function isStructuredMarketText(text) {
  return Boolean(text) && (/[＠@]/.test(text) || /滚球|让球|大小|角球|波胆|单双|盘口|独赢/.test(text));
}

function analyzeSourceMessage(text) {
  const parsed = parseSourceMessage(text);
  const lines = splitTextLines(text);
  const isStructuredTicket = Boolean(
    lines.length >= 3 &&
      parsed.league &&
      parsed.teams &&
      parsed.marketText &&
      isStructuredMarketText(parsed.marketText)
  );

  return {
    lines,
    parsed,
    isStructuredTicket,
    feedbackSignal: isStructuredTicket ? null : extractFeedbackSignal(text)
  };
}

function buildTicketDraftFromSourceText(text, baseTicket = {}) {
  const sourceAnalysis = analyzeSourceMessage(text);
  if (!sourceAnalysis.isStructuredTicket) return null;

  return normalizeTicketDraft({
    sourceChannelId: baseTicket.sourceChannelId || "",
    league: sourceAnalysis.parsed.league,
    teams: sourceAnalysis.parsed.teams,
    marketText: sourceAnalysis.parsed.marketText,
    rawOdds: Number(sourceAnalysis.parsed.rawOdds || 0),
    rebate: Number(baseTicket.rebate || 0),
    deliveryTarget: Number(baseTicket.deliveryTarget || 0)
  });
}

function normalizeTicketDraft(ticket = {}) {
  return {
    sourceChannelId: ticket.sourceChannelId || "",
    league: String(ticket.league || "").trim(),
    teams: String(ticket.teams || "").trim(),
    marketText: String(ticket.marketText || "").trim(),
    rawOdds: Number(ticket.rawOdds || 0),
    rebate: Number(ticket.rebate || 0),
    deliveryTarget: Number(ticket.deliveryTarget || 0)
  };
}

function hasStableTicketShape(ticket) {
  return Boolean(ticket?.league && ticket?.teams && ticket?.marketText);
}

function rememberStableTicket(ticket) {
  const normalized = normalizeTicketDraft(ticket);
  if (!hasStableTicketShape(normalized)) return;
  state.lastStableTicket = normalized;
  saveJson(storageKeys.stableTicket, normalized);
}

function findLatestStructuredTicketFromLogs(logs, baseTicket) {
  for (const log of logs || []) {
    if (!/收到 .*消息:/.test(log.message || "")) continue;
    const messageText = String(log.message).split("消息:").slice(1).join("消息:").trim();
    if (!messageText) continue;

    const draft = buildTicketDraftFromSourceText(messageText, baseTicket);
    if (draft && hasStableTicketShape(draft)) {
      return draft;
    }
  }

  return null;
}

function getProtectedConsoleTicket(ticket, sourceAnalysis, logs) {
  const normalized = normalizeTicketDraft(ticket);
  if (hasStableTicketShape(normalized)) {
    rememberStableTicket(normalized);
    return normalized;
  }

  if (sourceAnalysis?.isStructuredTicket) {
    return normalized;
  }

  const fallbackTicket = state.lastStableTicket || findLatestStructuredTicketFromLogs(logs, normalized);
  if (!fallbackTicket) {
    return normalized;
  }

  rememberStableTicket(fallbackTicket);

  return {
    ...normalized,
    league: fallbackTicket.league,
    teams: fallbackTicket.teams,
    marketText: fallbackTicket.marketText,
    rawOdds: fallbackTicket.rawOdds || normalized.rawOdds,
    rebate: normalized.rebate || fallbackTicket.rebate,
    deliveryTarget: normalized.deliveryTarget || fallbackTicket.deliveryTarget
  };
}

function syncMarketOddsFromInput() {
  const rawOdds = parseRawOdds(els.inpMarket.value);
  if (rawOdds) {
    els.oddsRaw.value = rawOdds;
  }
}

function formatSourceChannelLabel(channel) {
  const prefix = channel.type === "whatsapp" ? "WA" : channel.type === "telegram" ? "TG" : "";
  const base = prefix ? `[${prefix}] ${channel.label}` : channel.label;
  if (!channel.note || channel.note === channel.label) {
    return base;
  }
  return `${base} · ${channel.note}`;
}

function quickReplyValue(label) {
  const match = String(label).match(/^([^\s(]+)/);
  return match?.[1] || String(label).trim();
}

function formatRecentChatLabel(chat) {
  const prefix = chat.platform === "whatsapp" ? "WA" : "TG";
  const title = chat.title || chat.label || chat.remoteId;
  const type = chat.type ? `[${chat.type}]` : "";
  return `[${prefix}] ${title} ${type}`.trim();
}

function deriveCommandTone(command) {
  const text = `${command.label} ${command.text}`;
  if (/取消|停止|撤单/.test(text)) return "danger";
  if (/等等|暂停|恢复|继续/.test(text)) return "warning";
  return "";
}

function normalizeSharedSettings(settings = {}) {
  const commands = Array.isArray(settings.customCommands)
    ? settings.customCommands.map((item, index) => normalizeCommand(item, index)).filter((item) => item.text)
    : [];

  return {
    exchangeRate: Number(settings.exchangeRate ?? defaultConsoleSettings.exchangeRate) || defaultConsoleSettings.exchangeRate,
    specialTarget: Number(settings.specialTarget ?? defaultConsoleSettings.specialTarget) || 0,
    followAmount: Number(settings.followAmount ?? defaultConsoleSettings.followAmount) || 0,
    manualAmericas: Boolean(settings.manualAmericas ?? defaultConsoleSettings.manualAmericas),
    customCommands: commands.length
      ? commands
      : defaultConsoleSettings.customCommands.map((item, index) => normalizeCommand(item, index))
  };
}

function normalizeCommandList(list = []) {
  return list.map((item) => ({
    id: String(item.id || ""),
    label: String(item.label || ""),
    text: String(item.text || "")
  }));
}

function sameCommandSet(left = [], right = []) {
  return JSON.stringify(normalizeCommandList(left)) === JSON.stringify(normalizeCommandList(right));
}

function sameSharedSettings(left, right) {
  return (
    Number(left.exchangeRate) === Number(right.exchangeRate) &&
    Number(left.specialTarget) === Number(right.specialTarget) &&
    Number(left.followAmount) === Number(right.followAmount) &&
    Boolean(left.manualAmericas) === Boolean(right.manualAmericas) &&
    sameCommandSet(left.customCommands, right.customCommands)
  );
}

function hasLegacySharedOverrides() {
  const normalizedLegacy = normalizeSharedSettings(legacySharedSettings);
  return (
    !sameSharedSettings(normalizedLegacy, normalizeSharedSettings(defaultConsoleSettings)) ||
    Object.keys(legacySharedSettings.resourceCurrencies || {}).length > 0
  );
}

function shouldUseLegacySharedState(serverSettings) {
  return !state.legacySettingsMigrated && hasLegacySharedOverrides() && sameSharedSettings(serverSettings, defaultConsoleSettings);
}

function resolveResourceCurrencies(resources = []) {
  return Object.fromEntries(
    resources.map((resource) => {
      const serverCurrency = resource.currency === "RMB" ? "RMB" : "U";
      const legacyCurrency = legacySharedSettings.resourceCurrencies?.[resource.id];
      const currency =
        !state.legacySettingsMigrated && serverCurrency === "U" && legacyCurrency === "RMB"
          ? "RMB"
          : serverCurrency;
      return [resource.id, currency];
    })
  );
}

function getSnapshotConsoleSettings(snapshot) {
  const serverSettings = normalizeSharedSettings(snapshot?.consoleSettings || defaultConsoleSettings);
  if (shouldUseLegacySharedState(serverSettings)) {
    return normalizeSharedSettings(legacySharedSettings);
  }
  return serverSettings;
}

function applySharedSettings(snapshot) {
  const sharedSettings = getSnapshotConsoleSettings(snapshot);
  state.customCommands = sharedSettings.customCommands;
  state.exchangeRate = sharedSettings.exchangeRate;
  state.specialTarget = sharedSettings.specialTarget;
  state.followAmount = sharedSettings.followAmount;
  state.manualAmericas = sharedSettings.manualAmericas;
  state.resourceCurrencies = resolveResourceCurrencies(snapshot?.resources || []);
  state.sharedSettingsHydrated = true;
}

function buildConsoleSettingsPayload() {
  return {
    exchangeRate: state.exchangeRate,
    specialTarget: state.specialTarget,
    followAmount: state.followAmount,
    manualAmericas: state.manualAmericas,
    customCommands: state.customCommands.map((command) => ({
      id: command.id,
      label: command.label,
      text: command.text
    }))
  };
}

function notifySharedConfigUnavailable(error) {
  if (error?.status !== 404) {
    return false;
  }

  if (!state.consoleSettingsUnsupportedNotified) {
    state.consoleSettingsUnsupportedNotified = true;
    notify("当前后端还是旧版本，请重启本地服务后再使用共享配置", "red", true);
  }

  return true;
}

async function persistConsoleSettingsNow(successText = "") {
  try {
    await api("/api/console-settings", {
      method: "PATCH",
      body: buildConsoleSettingsPayload()
    });
  } catch (error) {
    if (notifySharedConfigUnavailable(error)) {
      return false;
    }
    throw error;
  }

  if (successText) {
    notify(successText, "blue", true);
  }

  return true;
}

const scheduleConsoleSettingsSync = debounce(async () => {
  try {
    await persistConsoleSettingsNow();
  } catch (error) {
    notify(error.message, "red", true);
  }
}, 300);

async function migrateLegacySharedState(snapshot) {
  if (state.legacySettingsMigrated || !hasLegacySharedOverrides()) {
    state.legacySettingsMigrated = true;
    return;
  }

  if (!snapshot?.consoleSettings) {
    if (!state.consoleSettingsUnsupportedNotified) {
      state.consoleSettingsUnsupportedNotified = true;
      notify("当前后端还是旧版本，请重启本地服务后再迁移共享配置", "red", true);
    }
    return;
  }

  const serverSettings = normalizeSharedSettings(snapshot?.consoleSettings || defaultConsoleSettings);
  const shouldMigrateSettings = shouldUseLegacySharedState(serverSettings);
  const currencyUpdates = (snapshot?.resources || [])
    .map((resource) => ({
      resourceId: resource.id,
      currency: legacySharedSettings.resourceCurrencies?.[resource.id],
      serverCurrency: resource.currency === "RMB" ? "RMB" : "U"
    }))
    .filter((item) => item.currency && item.currency !== item.serverCurrency);

  if (!shouldMigrateSettings && !currencyUpdates.length) {
    state.legacySettingsMigrated = true;
    return;
  }

  try {
    if (shouldMigrateSettings) {
      await api("/api/console-settings", {
        method: "PATCH",
        body: {
          exchangeRate: legacySharedSettings.exchangeRate,
          specialTarget: legacySharedSettings.specialTarget,
          followAmount: legacySharedSettings.followAmount,
          manualAmericas: legacySharedSettings.manualAmericas,
          customCommands: legacySharedSettings.customCommands
        }
      });
    }

    if (currencyUpdates.length) {
      await Promise.all(
        currencyUpdates.map((item) =>
          api(`/api/resources/${item.resourceId}`, {
            method: "PATCH",
            body: { currency: item.currency }
          })
        )
      );
    }

    state.legacySettingsMigrated = true;
    notify("已将本机旧配置迁移到服务端共享状态", "blue", true);
  } catch (error) {
    if (notifySharedConfigUnavailable(error)) {
      return;
    }
    notify(`共享配置迁移失败: ${error.message}`, "red", true);
  }
}

function renderQuickReplies() {
  els.quickReplyContainer.innerHTML = supplierQuickReplies
    .map((reply) => `<button class="btn" data-quick-reply="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`)
    .join("");
}

function renderCustomCommands() {
  if (!state.customCommands.length) {
    els.customCommandContainer.innerHTML =
      "<div class='ops-note' style='grid-column: span 6;'>暂无快捷指令，请点击右上角管理按钮新增。</div>";
    return;
  }

  els.customCommandContainer.innerHTML = state.customCommands
    .map((command) => {
      const tone = deriveCommandTone(command);
      return `
        <button class="command-btn${tone ? ` ${tone}` : ""}" data-command-id="${escapeHtml(command.id)}" title="${escapeHtml(command.text)}">
          ${escapeHtml(command.label)}
        </button>
      `;
    })
    .join("");
}

function renderCommandEditor() {
  els.commandEditorList.innerHTML = state.customCommands
    .map(
      (command) => `
        <div class="command-editor-row" data-command-editor-id="${escapeHtml(command.id)}">
          <div class="form-item" style="margin-bottom: 0;">
            <label>按钮标题</label>
            <input class="command-editor-label" value="${escapeHtml(command.label)}" placeholder="例如：等等">
          </div>
          <div class="form-item" style="margin-bottom: 0;">
            <label>发送文本</label>
            <input class="command-editor-text" value="${escapeHtml(command.text)}" placeholder="例如：等等 / 先暂停">
          </div>
          <button class="icon-btn" data-command-editor-delete="true">删除</button>
        </div>
      `
    )
    .join("");
}

function openCommandModal() {
  renderCommandEditor();
  els.commandModal.classList.add("open");
}

function closeCommandModal() {
  els.commandModal.classList.remove("open");
}

function getSourceChannelById(sourceChannelId) {
  return state.snapshot?.sourceChannels?.find((item) => item.id === sourceChannelId) || null;
}

function getResourceById(resourceId) {
  return state.snapshot?.resources?.find((item) => item.id === resourceId) || null;
}

function getSelectedRecentChat() {
  if (!state.selectedRecentChatKey) return null;
  return state.recentChats.find((item) => `${item.platform}::${item.remoteId}` === state.selectedRecentChatKey) || null;
}

function getResourceCurrency(resourceId) {
  return state.resourceCurrencies[resourceId] === "RMB" ? "RMB" : "U";
}

function toUsd(amount, currency) {
  const numericAmount = Number(amount || 0);
  if (currency === "RMB") {
    return numericAmount / getExchangeRateValue();
  }
  return numericAmount;
}

function updateResourceRowState(row) {
  const sendInput = row.querySelector(".resource-send");
  const amountInput = row.querySelector(".resource-amount");
  const enabled = Boolean(sendInput?.checked);
  row.classList.toggle("disabled", !enabled);
  if (amountInput) {
    amountInput.disabled = !enabled;
  }
}

function collectResourcePatch(row) {
  return {
    name: row.querySelector(".resource-name")?.value.trim() || "",
    remoteId: row.querySelector(".resource-bind")?.value.trim() || "",
    sendEnabled: Boolean(row.querySelector(".resource-send")?.checked),
    canAmericas: Boolean(row.querySelector(".resource-americas")?.checked),
    amount: Number(row.querySelector(".resource-amount")?.value || 0),
    slipCount: Number(row.querySelector(".resource-slip")?.value || 0),
    allocationType: row.querySelector(".resource-type")?.value || "fixed",
    currency: row.querySelector(".resource-currency")?.value === "RMB" ? "RMB" : "U"
  };
}

function applyAmericasConstraints() {
  const americasOrder = isAmericasOrder();

  document.querySelectorAll(".rc-row").forEach((row) => {
    const sendInput = row.querySelector(".resource-send");
    const canAmericasInput = row.querySelector(".resource-americas");
    if (!sendInput || !canAmericasInput) return;

    if (americasOrder && !canAmericasInput.checked && sendInput.checked) {
      sendInput.checked = false;
      const resourceId = row.dataset.resourceId;
      if (resourceId) {
        scheduleResourceSync(resourceId, collectResourcePatch(row));
      }
    }

    updateResourceRowState(row);
  });
}

function renderTargetHint(effectiveTarget, allocated, gap) {
  if (isAmericasOrder()) {
    els.targetHintText.textContent = `特殊赛额度 + 跟注额 = ${formatMoney(effectiveTarget)} USD，缺口 ${formatMoney(gap)} USD`;
  } else {
    els.targetHintText.textContent = `常规赛额度 + 跟注额 = ${formatMoney(effectiveTarget)} USD，已分配 ${formatMoney(allocated)} USD`;
  }
}

function syncReceiptOddsFromCalculated(force = false) {
  const calculatedOdds = formatMoney(Number(els.oddsFinal.value || 0));
  const currentReceiptOdds = String(els.recOdds.value || "").trim();
  if (force || !state.receiptOddsManual || !currentReceiptOdds) {
    els.recOdds.value = calculatedOdds;
  }
}

function updateReceiptOddsManualState() {
  const currentReceiptOdds = String(els.recOdds.value || "").trim();
  const calculatedOdds = formatMoney(Number(els.oddsFinal.value || 0));
  state.receiptOddsManual = Boolean(currentReceiptOdds && currentReceiptOdds !== calculatedOdds);
}

function normalizeReceiptOddsInput() {
  const rawValue = String(els.recOdds.value || "").trim();
  if (!rawValue) {
    state.receiptOddsManual = false;
    syncReceiptOddsFromCalculated(true);
    return;
  }

  const normalized = rawValue.replace(/[^\d.]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    state.receiptOddsManual = false;
    syncReceiptOddsFromCalculated(true);
    return;
  }

  els.recOdds.value = formatMoney(parsed);
  updateReceiptOddsManualState();
}

function calculateLocal() {
  applyAmericasConstraints();

  const raw = Number(els.oddsRaw.value || 0);
  const rebate = Number(els.oddsRebate.value || 0);
  const finalOdds = Math.max(raw - rebate, 0);
  els.oddsFinal.value = formatMoney(finalOdds);
  syncReceiptOddsFromCalculated();

  let allocated = 0;
  document.querySelectorAll(".rc-row").forEach((row) => {
    if (!row.querySelector(".resource-send")?.checked) return;
    const amount = Number(row.querySelector(".resource-amount")?.value || 0);
    const currency = row.querySelector(".resource-currency")?.value || "U";
    allocated += toUsd(amount, currency);
  });

  const regularTarget = Math.max(Number(els.targetTotal.value || 0), 0);
  const specialTarget = getSpecialTargetValue();
  const followAmount = getFollowAmountValue();
  const effectiveTarget = isAmericasOrder()
    ? Math.max(specialTarget + followAmount, 0)
    : Math.max(regularTarget + followAmount, 0);
  const gap = Math.max(effectiveTarget - allocated, 0);

  els.targetAllocated.value = formatMoney(allocated);
  els.effectiveTarget.value = formatMoney(effectiveTarget);
  els.targetGap.value = formatMoney(gap);
  els.sumConfirmed.textContent = `已分配: ${formatMoney(allocated)}U`;
  els.gapBox.className = gap > 0 ? "data-box gap-alert" : "data-box";
  els.gapBox.style.background = gap > 0 ? "" : "#f0f9eb";
  els.gapBox.style.borderColor = gap > 0 ? "" : "#e1f3d8";
  renderTargetHint(effectiveTarget, allocated, gap);

  updateReceiptText();
}

function updateReceiptText() {
  const count = els.recCount.value;
  const league = els.inpLeague.value;
  const team = els.inpTeam.value;
  const marketClean = els.inpMarket.value.split("@")[0].trim();
  const finalOdds = String(els.recOdds.value || els.oddsFinal.value || "").trim();
  const amt = els.recAmt.value;
  els.recText.value = `${count}.${league}\n${team}\n${marketClean} @ ${finalOdds}确${amt}`;
}

function renderSourceChannels(snapshot) {
  const channels = snapshot.sourceChannels || [];
  const fallbackId = snapshot.currentTicket?.sourceChannelId || channels[0]?.id || "";
  if (!channels.some((item) => item.id === state.selectedSourceId)) {
    state.selectedSourceId = fallbackId;
  }

  const optionHtml = channels.length
    ? channels
        .map((channel) => `<option value="${channel.id}">${escapeHtml(formatSourceChannelLabel(channel))}</option>`)
        .join("")
    : "<option value=''>暂无供应商</option>";

  if (els.sourceChannelSelect.innerHTML !== optionHtml) {
    els.sourceChannelSelect.innerHTML = optionHtml;
  }
  els.sourceChannelSelect.value = state.selectedSourceId || "";

  const selected = channels.find((item) => item.id === state.selectedSourceId) || null;
  setBadge(
    els.sourceOnlineBadge,
    selected?.online ? "在线" : channels.length ? "离线" : "未绑定",
    selected?.online ? "blue" : selected ? "red" : ""
  );
  els.sourceDeleteBtn.disabled = !selected;
}

function renderResources(resources) {
  if (!resources.length) {
    els.resourceContainer.innerHTML =
      "<div class='ops-note'>暂无分销商绑定，请先在左侧“发现与绑定”中新增。</div>";
    els.recTarget.innerHTML = "<option value=''>暂无资源</option>";
    return;
  }

  const html = resources
    .map((resource) => {
      const disabled = !resource.sendEnabled;
      const currency = getResourceCurrency(resource.id);
      return `
        <div class="rc-row${disabled ? " disabled" : ""}" data-resource-id="${resource.id}">
          <div class="rc-id">
            <input class="name resource-name" value="${escapeHtml(resource.name || "")}">
            <input class="bind resource-bind" value="${escapeHtml(
              resource.remoteId || ""
            )}" placeholder="${escapeHtml(resource.bindingLabel || "remoteId / jid")}" title="${escapeHtml(
              resource.note || resource.bindingLabel || ""
            )}">
          </div>
          <div class="rc-chk">
            <label><input type="checkbox" class="resource-send" ${
              resource.sendEnabled ? "checked" : ""
            }> 可发送</label>
            <label><input type="checkbox" class="resource-americas" ${
              resource.canAmericas ? "checked" : ""
            }> 可接美洲</label>
          </div>
          <div class="rc-amt">
            <input type="number" class="resource-amount" value="${resource.amount ?? 0}" ${
              disabled ? "disabled" : ""
            }>
            <select class="resource-currency">
              <option value="U" ${currency === "U" ? "selected" : ""}>U</option>
              <option value="RMB" ${currency === "RMB" ? "selected" : ""}>RMB</option>
            </select>
          </div>
          <div class="rc-cfg">
            <input type="number" class="resource-slip" value="${resource.slipCount ?? 0}">
            <select class="resource-type">
              <option value="fixed" ${resource.allocationType === "fixed" ? "selected" : ""}>固定</option>
              <option value="floating" ${
                resource.allocationType === "floating" ? "selected" : ""
              }>浮动</option>
            </select>
          </div>
          <div class="rc-btn">
            <button data-resource-action="prep">预备</button>
            <button data-resource-action="market">盘口</button>
            <button data-resource-action="receipt">回执</button>
            <button data-resource-action="delete" class="delete">删</button>
          </div>
        </div>
      `;
    })
    .join("");

  els.resourceContainer.innerHTML = html;
  els.recTarget.innerHTML = resources
    .map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)}</option>`)
    .join("");

  if (!resources.some((item) => item.id === state.selectedReceiptResourceId)) {
    state.selectedReceiptResourceId = resources[0]?.id || "";
  }
  if (state.selectedReceiptResourceId) {
    els.recTarget.value = state.selectedReceiptResourceId;
    loadReceiptResource(state.selectedReceiptResourceId);
  }

  applyAmericasConstraints();
}

function renderRecentChats() {
  const platform = els.bindPlatformSelect.value;
  const searchQuery = String(els.bindSearchInput?.value || "")
    .trim()
    .toLowerCase();
  const platformScoped = state.recentChats.filter(
    (chat) => platform === "all" || chat.platform === platform
  );
  const filtered = platformScoped.filter((chat) => {
    if (!searchQuery) return true;
    const haystack = [
      chat.title,
      chat.label,
      chat.remoteId,
      chat.platform,
      chat.type,
      formatRecentChatLabel(chat)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchQuery);
  });
  setBadge(
    els.bindScopeBadge,
    searchQuery ? `${filtered.length} / ${platformScoped.length} 个会话` : `${filtered.length} 个会话`,
    "blue"
  );

  const optionHtml = filtered.length
    ? filtered
        .map((chat) => {
          const key = `${chat.platform}::${chat.remoteId}`;
          return `<option value="${escapeHtml(key)}">${escapeHtml(
            formatRecentChatLabel(chat)
          )}</option>`;
        })
        .join("")
    : `<option value=''>${searchQuery ? "未找到匹配会话" : "暂无最近会话"}</option>`;

  els.bindDiscoverySelect.innerHTML = optionHtml;
  if (
    !filtered.some(
      (chat) => `${chat.platform}::${chat.remoteId}` === state.selectedRecentChatKey
    )
  ) {
    state.selectedRecentChatKey = filtered[0]
      ? `${filtered[0].platform}::${filtered[0].remoteId}`
      : "";
  }

  if (state.selectedRecentChatKey) {
    els.bindDiscoverySelect.value = state.selectedRecentChatKey;
  }

  const selected = getSelectedRecentChat();
  if (selected) {
    if (!els.bindNoteInput.value.trim()) {
      els.bindNoteInput.value = selected.title || selected.label || "";
    }
    els.bindMetaText.textContent = [
      `平台: ${selected.platform}`,
      `会话: ${selected.title || selected.label || selected.remoteId}`,
      selected.lastMessageAt
        ? `最近活动: ${new Date(selected.lastMessageAt).toLocaleString("zh-CN", {
            hour12: false
          })}`
        : "最近活动: 未知"
    ].join(" | ");
  } else {
    els.bindMetaText.textContent = searchQuery
      ? "没有匹配结果，试试群名、联系人名、ID 或平台关键词。"
      : "先拉取最近会话，再选择身份并绑定。";
  }
}

function renderFeedbackBox(box, textElement, buttonElement, options) {
  const title = options.title;
  const value = options.value || "--";
  const idleText = options.idleText;
  const actionText = options.actionText;
  const hasValue = Boolean(options.value);

  box.classList.toggle("empty", !hasValue);
  textElement.innerHTML = `<span class="feedback-title">${escapeHtml(title)}</span><b>${escapeHtml(value)}</b>`;
  buttonElement.disabled = !hasValue;
  buttonElement.textContent = hasValue ? `${actionText} ${value}` : idleText;
}

function parseReceivedLogEntry(log) {
  const message = String(log?.message || "");
  const match = message.match(/^收到 (WhatsApp|Telegram UserBot) 消息:\s*([\s\S]+)$/);
  if (!match) return null;

  return {
    platform: match[1] === "WhatsApp" ? "whatsapp" : "telegram",
    text: match[2].trim()
  };
}

function findLatestFeedbackPrice(logs, currentSource) {
  let sourceEchoSkipped = false;

  for (const log of logs || []) {
    const entry = parseReceivedLogEntry(log);
    if (!entry?.text) continue;

    if (
      !sourceEchoSkipped &&
      currentSource?.text &&
      currentSource?.platform &&
      entry.platform === currentSource.platform &&
      entry.text === currentSource.text
    ) {
      sourceEchoSkipped = true;
      continue;
    }

    const signal = extractFeedbackSignal(entry.text);
    if (!signal) continue;

    return signal.text;
  }

  return "";
}

function renderSupplierFeedback(snapshot) {
  const ticket = snapshot.currentTicket || {};
  const sourceChannel = getSourceChannelById(ticket.sourceChannelId);
  const price = findLatestFeedbackPrice(snapshot.logs, {
    platform: sourceChannel?.type || "",
    text: ticket.sourceMessage?.text || ""
  });
  state.latestFeedbackPrice = price;

  renderFeedbackBox(els.supplierFeedbackBox, els.supplierFeedbackText, els.supplierFeedbackBtn, {
    title: "下游反馈",
    value: price,
    actionText: "向供应商反馈",
    idleText: "等待下游反馈"
  });
}

function renderResourceReprice(sourceAnalysis) {
  const repriceText = sourceAnalysis?.feedbackSignal?.text || "";
  state.latestSupplierRepriceText = repriceText;

  renderFeedbackBox(els.resourceRepriceBox, els.resourceRepriceText, els.resourceRepriceBtn, {
    title: "源头反馈",
    value: repriceText,
    actionText: "向资源同步",
    idleText: "等待源头反馈"
  });
}

async function extractSourceMessageToConsole({ toast = true } = {}) {
  const text = state.snapshot?.currentTicket?.sourceMessage?.text || "";
  const sourceAnalysis = analyzeSourceMessage(text);
  const parsed = sourceAnalysis.parsed;

  if (!sourceAnalysis.isStructuredTicket) {
    if (toast) {
      notify("当前消息更像反馈/聊天，已保留上一张有效单，不覆盖中控台", "red", true);
    }
    return;
  }

  els.inpLeague.value = parsed.league;
  els.inpTeam.value = parsed.teams;
  els.inpMarket.value = parsed.marketText;
  if (parsed.rawOdds) {
    els.oddsRaw.value = parsed.rawOdds;
  } else {
    syncMarketOddsFromInput();
  }
  rememberStableTicket(currentTicketPatch());
  calculateLocal();

  try {
    await api("/api/ticket/current", {
      method: "PATCH",
      body: currentTicketPatch()
    });
    notify("已提取最新供应商消息到中控台", "blue", toast);
  } catch (error) {
    notify(error.message, "red", true);
  }
}

function renderPersistentControls() {
  els.exchangeRate.value = formatMoney(state.exchangeRate);
  els.specialTarget.value = formatMoney(state.specialTarget);
  els.followAmount.value = formatMoney(state.followAmount);
  els.americasOrderCheckbox.checked = state.manualAmericas;
}

function renderSnapshot(snapshot) {
  const previousFingerprint = state.lastSourceFingerprint;
  state.snapshot = snapshot;
  applySharedSettings(snapshot);
  const ticket = snapshot.currentTicket || {};
  const sourceAnalysis = analyzeSourceMessage(ticket.sourceMessage?.text || "");
  const displayTicket = getProtectedConsoleTicket(ticket, sourceAnalysis, snapshot.logs || []);
  renderPersistentControls();
  renderSourceChannels(snapshot);
  renderResources(snapshot.resources || []);
  renderSupplierFeedback(snapshot);
  renderResourceReprice(sourceAnalysis);

  setBadge(els.ticketIdBadge, `单号 ${ticket.id || "--"}`);
  els.inpLeague.value = displayTicket.league || "";
  els.inpTeam.value = displayTicket.teams || "";
  els.inpMarket.value = displayTicket.marketText || "";
  const snapshotRawOdds = Number(displayTicket.rawOdds || 0);
  els.oddsRaw.value =
    snapshotRawOdds > 0 ? String(displayTicket.rawOdds) : parseRawOdds(displayTicket.marketText || "") || "";
  els.oddsRebate.value = displayTicket.rebate ?? 0;
  els.targetTotal.value = displayTicket.deliveryTarget ?? 0;

  els.sourceArrivedAt.textContent = ticket.sourceMessage?.arrivedAt
    ? `${ticket.sourceMessage.arrivedAt} 收到下发`
    : "等待通道消息";
  els.sourceMessageText.innerHTML = textToHtml(ticket.sourceMessage?.text || "尚未收到新消息");

  calculateLocal();

  const sourceFingerprint = `${ticket.sourceChannelId || ""}|${ticket.sourceMessage?.arrivedAt || ""}|${
    ticket.sourceMessage?.text || ""
  }`;
  if (sourceAnalysis.isStructuredTicket && ticket.sourceMessage?.text && sourceFingerprint !== previousFingerprint) {
    state.lastSourceFingerprint = sourceFingerprint;
    void extractSourceMessageToConsole({ toast: false });
  } else {
    state.lastSourceFingerprint = sourceFingerprint;
  }

  void migrateLegacySharedState(snapshot);
}

function renderWhatsAppStatus(status) {
  state.integration.whatsapp = status;
  const tone = status.connection === "open" ? "blue" : status.lastError ? "red" : "";
  setBadge(els.waStatusBadge, status.status || "待登录", tone);

  if (status.qrDataUrl) {
    els.waQrImage.src = status.qrDataUrl;
    els.waQrImage.hidden = false;
    els.waQrHint.hidden = true;
  } else {
    els.waQrImage.hidden = true;
    els.waQrHint.hidden = false;
    els.waQrHint.textContent =
      status.connection === "connecting"
        ? "登录窗口已启动，二维码会在网页或弹出的 Chrome 中出现"
        : "点击“取二维码”后在此显示";
  }

  els.waPairCode.textContent = status.pairingCode || "配对码尚未生成";
  els.waMetaText.textContent = [
    `连接: ${status.connection}`,
    `认证: ${status.authenticated ? "已完成" : "未完成"}`,
    `队列: ${status.queue.pending}/${status.queue.maxSize}`,
    status.lastError ? `最近错误: ${status.lastError}` : "最近错误: 无"
  ].join(" | ");
}

function renderTelegramStatus(status) {
  state.integration.telegram = status;
  const tone = status.authorized ? "blue" : status.lastError ? "red" : "";
  setBadge(els.tgStatusBadge, status.status || "待配置", tone);
  els.tgMetaText.textContent = [
    `配置: ${status.configured ? "已配置" : "未配置"}`,
    `授权: ${status.authorized ? "已登录" : "未登录"}`,
    status.pendingLogin?.phoneNumberMasked ? `手机号: ${status.pendingLogin.phoneNumberMasked}` : "",
    status.lastError ? `最近错误: ${status.lastError}` : "最近错误: 无"
  ]
    .filter(Boolean)
    .join(" | ");
}

async function refreshIntegrationStatuses() {
  try {
    const [whatsapp, telegram] = await Promise.all([
      api("/api/integrations/whatsapp/status"),
      api("/api/integrations/telegram-userbot/status")
    ]);
    renderWhatsAppStatus(whatsapp);
    renderTelegramStatus(telegram);
  } catch (error) {
    notify(error.message, "red");
  }
}

async function refreshRecentChats(showToast = false) {
  try {
    state.recentChats = await api("/api/discovery/recent-chats?limit=80");
    renderRecentChats();
    if (showToast) {
      notify(`已拉取 ${state.recentChats.length} 个最近会话`, "blue", true);
    }
  } catch (error) {
    notify(error.message, "red", true);
  }
}

async function postResourcePatch(resourceId, patch) {
  await api(`/api/resources/${resourceId}`, {
    method: "PATCH",
    body: patch
  });
}

const syncTicket = debounce(async () => {
  try {
    rememberStableTicket(currentTicketPatch());
    await api("/api/ticket/current", {
      method: "PATCH",
      body: currentTicketPatch()
    });
    notify("已同步交易单", "blue");
  } catch (error) {
    notify(error.message, "red", true);
  }
}, 300);

function scheduleResourceSync(resourceId, patch) {
  clearTimeout(state.resourceSyncTimers[resourceId]);
  state.resourceSyncTimers[resourceId] = setTimeout(async () => {
    try {
      await postResourcePatch(resourceId, patch);
      notify("已同步分销商配置", "blue");
    } catch (error) {
      notify(error.message, "red", true);
    }
  }, 300);
}

function loadReceiptResource(resourceId) {
  const resource = getResourceById(resourceId);
  if (!resource) return;
  state.selectedReceiptResourceId = resourceId;
  els.recTarget.value = resourceId;
  els.recAmt.value = resource.amount ?? 0;
  els.recCount.value = Number(resource.slipCount || 0) + 1;
  syncReceiptOddsFromCalculated();
  updateReceiptText();
}

function buildSummaryText() {
  const ticket = currentTicketPatch();
  const resources = Array.from(document.querySelectorAll(".rc-row")).map((row) => {
    const amount = Number(row.querySelector(".resource-amount")?.value || 0);
    const currency = row.querySelector(".resource-currency")?.value || "U";
    return {
      name: row.querySelector(".resource-name")?.value || "",
      enabled: Boolean(row.querySelector(".resource-send")?.checked),
      amount,
      currency,
      usdAmount: toUsd(amount, currency),
      remoteId: row.querySelector(".resource-bind")?.value || ""
    };
  });

  const enabledResources = resources.filter((item) => item.enabled);
  const total = enabledResources.reduce((sum, item) => sum + item.usdAmount, 0);

  return [
    `单号: ${state.snapshot?.currentTicket?.id || "--"}`,
    `品类: ${ticket.league}`,
    `品牌: ${ticket.teams}`,
    `报价: ${ticket.marketText}`,
    `回执水位: ${els.oddsFinal.value}`,
    `总目标: ${formatMoney(Number(els.effectiveTarget.value || 0))}U`,
    `已分配: ${formatMoney(total)}U`,
    "分销商明细:",
    ...enabledResources.map(
      (item) =>
        `- ${item.name} | ${item.amount}${item.currency} | 折合 ${formatMoney(item.usdAmount)}U | ${
          item.remoteId || "未绑定"
        }`
    )
  ].join("\n");
}

async function copyText(text, successText) {
  await navigator.clipboard.writeText(text);
  notify(successText, "blue", true);
}

async function sendBroadcastCustom(text, successText) {
  await api("/api/actions/broadcast-custom", {
    method: "POST",
    body: { text }
  });
  notify(successText, "blue", true);
}

async function sendPrepBroadcast() {
  const league = els.inpLeague.value.trim();
  const teams = els.inpTeam.value.trim();
  if (!league || !teams) {
    notify("预备单至少需要品类和品牌两行内容", "red", true);
    return;
  }

  await sendBroadcastCustom(`${league}\n${teams}`, "已发送预备单");
}

function bindCoreInputs() {
  [els.inpLeague, els.inpTeam, els.oddsRaw, els.oddsRebate, els.targetTotal].forEach(
    (element) => {
      element.addEventListener("input", () => {
        calculateLocal();
        syncTicket();
      });
    }
  );

  els.inpMarket.addEventListener("input", () => {
    syncMarketOddsFromInput();
    calculateLocal();
    syncTicket();
  });

  els.exchangeRate.addEventListener("input", () => {
    state.exchangeRate = getExchangeRateValue();
    calculateLocal();
    scheduleConsoleSettingsSync();
  });

  els.specialTarget.addEventListener("input", () => {
    state.specialTarget = getSpecialTargetValue();
    calculateLocal();
    scheduleConsoleSettingsSync();
  });

  els.followAmount.addEventListener("input", () => {
    state.followAmount = getFollowAmountValue();
    calculateLocal();
    scheduleConsoleSettingsSync();
  });

  els.americasOrderCheckbox.addEventListener("change", () => {
    state.manualAmericas = els.americasOrderCheckbox.checked;
    calculateLocal();
    scheduleConsoleSettingsSync();
  });

  [els.recTarget, els.recAmt, els.recCount, els.recOdds].forEach((element) => {
    element.addEventListener("input", updateReceiptText);
    element.addEventListener("change", updateReceiptText);
  });

  els.recOdds.addEventListener("input", () => {
    updateReceiptOddsManualState();
    updateReceiptText();
  });

  els.recOdds.addEventListener("blur", () => {
    normalizeReceiptOddsInput();
    updateReceiptText();
  });

  els.sourceChannelSelect.addEventListener("change", () => {
    state.selectedSourceId = els.sourceChannelSelect.value;
    syncTicket();
    renderSourceChannels(state.snapshot || { sourceChannels: [] });
  });

  els.quickReplyContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-quick-reply]");
    if (!button) return;
    try {
      await api("/api/actions/source-reply", {
        method: "POST",
        body: { text: quickReplyValue(button.dataset.quickReply) }
      });
      notify(`已回复供应商: ${button.dataset.quickReply}`, "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.supplierFeedbackBtn.addEventListener("click", async () => {
    if (!state.latestFeedbackPrice) {
      notify("当前没有可反馈的价格", "red", true);
      return;
    }

    try {
      await api("/api/actions/source-reply", {
        method: "POST",
        body: { text: state.latestFeedbackPrice }
      });
      notify(`已反馈供应商 ${state.latestFeedbackPrice}`, "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.resourceRepriceBtn.addEventListener("click", async () => {
    if (!state.latestSupplierRepriceText) {
      notify("当前没有可同步给资源的复水文本", "red", true);
      return;
    }

    try {
      await sendBroadcastCustom(state.latestSupplierRepriceText, `已同步资源 ${state.latestSupplierRepriceText}`);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.extractMessageBtn.addEventListener("click", () => {
    void extractSourceMessageToConsole({ toast: true });
  });

  els.sourceDeleteBtn.addEventListener("click", async () => {
    const sourceId = els.sourceChannelSelect.value;
    if (!sourceId) {
      notify("当前没有可删除的供应商", "red", true);
      return;
    }

    try {
      await api(`/api/source-channels/${sourceId}`, { method: "DELETE" });
      notify("已删除当前供应商绑定", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.corePrepBtn.addEventListener("click", async () => {
    try {
      await sendPrepBroadcast();
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.coreMarketBtn.addEventListener("click", async () => {
    try {
      await api("/api/actions/broadcast-market", { method: "POST" });
      notify("已发送报价", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.customCommandContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-command-id]");
    if (!button) return;
    const command = state.customCommands.find((item) => item.id === button.dataset.commandId);
    if (!command) return;

    try {
      await sendBroadcastCustom(command.text, `已发送快捷指令: ${command.label}`);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

function bindResourceEvents() {
  els.resourceContainer.addEventListener("change", (event) => {
    const row = event.target.closest(".rc-row");
    if (!row) return;

    const resourceId = row.dataset.resourceId;
    if (!resourceId) return;

    if (event.target.matches(".resource-currency")) {
      state.resourceCurrencies[resourceId] = event.target.value;
      scheduleResourceSync(resourceId, collectResourcePatch(row));
      calculateLocal();
      return;
    }

    if (event.target.matches(".resource-send") || event.target.matches(".resource-americas")) {
      updateResourceRowState(row);
    }

    scheduleResourceSync(resourceId, collectResourcePatch(row));
    calculateLocal();
  });

  els.resourceContainer.addEventListener("input", (event) => {
    const row = event.target.closest(".rc-row");
    if (!row) return;

    const resourceId = row.dataset.resourceId;
    if (!resourceId) return;

    if (event.target.matches(".resource-name, .resource-bind, .resource-amount, .resource-slip")) {
      scheduleResourceSync(resourceId, collectResourcePatch(row));
      calculateLocal();
    }
  });

  els.resourceContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-resource-action]");
    if (!button) return;

    const row = button.closest(".rc-row");
    const resourceId = row?.dataset.resourceId;
    if (!resourceId) return;

    const action = button.dataset.resourceAction;
    if (action === "receipt") {
      loadReceiptResource(resourceId);
      return;
    }

    if (action === "delete") {
      try {
        await api(`/api/resources/${resourceId}`, { method: "DELETE" });
        notify("已删除分销商绑定", "blue", true);
      } catch (error) {
        notify(error.message, "red", true);
      }
      return;
    }

    try {
      await api(`/api/actions/resources/${resourceId}/${action}`, { method: "POST" });
      notify(`已向分销商发送${action === "prep" ? "预备单" : "报价"}`, "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

function bindCommandEditorEvents() {
  els.commandManageBtn.addEventListener("click", openCommandModal);
  els.commandModalCloseBtn.addEventListener("click", closeCommandModal);
  els.commandModal.addEventListener("click", (event) => {
    if (event.target === els.commandModal) {
      closeCommandModal();
    }
  });

  els.commandAddBtn.addEventListener("click", () => {
    state.customCommands.push({
      id: makeId(),
      label: `指令 ${state.customCommands.length + 1}`,
      text: ""
    });
    renderCommandEditor();
  });

  els.commandEditorList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("button[data-command-editor-delete]");
    if (!deleteButton) return;
    const row = deleteButton.closest("[data-command-editor-id]");
    if (!row) return;
    state.customCommands = state.customCommands.filter(
      (command) => command.id !== row.dataset.commandEditorId
    );
    renderCommandEditor();
  });

  els.commandSaveBtn.addEventListener("click", async () => {
    const rows = Array.from(els.commandEditorList.querySelectorAll("[data-command-editor-id]"));
    const nextCommands = rows
      .map((row, index) =>
        normalizeCommand(
          {
            id: row.dataset.commandEditorId,
            label: row.querySelector(".command-editor-label")?.value.trim(),
            text: row.querySelector(".command-editor-text")?.value.trim()
          },
          index
        )
      )
      .filter((command) => command.text);

    state.customCommands = nextCommands.length
      ? nextCommands
      : defaultCustomCommands.map((item, index) => normalizeCommand(item, index));
    renderCustomCommands();

    try {
      await persistConsoleSettingsNow("快捷指令已保存");
      closeCommandModal();
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

function bindDiscoveryEvents() {
  els.bindPlatformSelect.addEventListener("change", renderRecentChats);
  els.bindSearchInput.addEventListener("input", renderRecentChats);

  els.bindDiscoverySelect.addEventListener("change", () => {
    state.selectedRecentChatKey = els.bindDiscoverySelect.value;
    const selected = getSelectedRecentChat();
    if (selected) {
      els.bindNoteInput.value = selected.title || selected.label || "";
    }
    renderRecentChats();
  });

  els.bindRefreshBtn.addEventListener("click", () => {
    void refreshRecentChats(true);
  });

  els.bindApplyBtn.addEventListener("click", async () => {
    state.selectedRecentChatKey = els.bindDiscoverySelect.value;
    const selected = getSelectedRecentChat();
    if (!selected) {
      notify("请先选择一个最近会话", "red", true);
      return;
    }

    try {
      const created = await api("/api/bindings", {
        method: "POST",
        body: {
          role: els.bindRoleSelect.value,
          platform: selected.platform,
          remoteId: selected.remoteId,
          title: selected.title || selected.label || selected.remoteId,
          note: els.bindNoteInput.value.trim()
        }
      });

      if (els.bindRoleSelect.value === "supplier") {
        state.selectedSourceId = created.id;
      }
      els.bindNoteInput.value = "";
      notify(
        `已绑定为${els.bindRoleSelect.value === "supplier" ? "供应商" : "分销商"}`,
        "blue",
        true
      );
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

function bindIntegrationEvents() {
  els.waConnectQrBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/connect", {
        method: "POST",
        body: { mode: "qr" }
      });
      await refreshIntegrationStatuses();
      notify("已请求 WhatsApp 登录二维码", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.waPairBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/connect", {
        method: "POST",
        body: {
          mode: "pairing_code",
          phoneNumber: els.waPairPhoneInput.value.trim()
        }
      });
      await refreshIntegrationStatuses();
      notify("已请求 WhatsApp 配对码", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.waReconnectBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/reconnect", { method: "POST" });
      await refreshIntegrationStatuses();
      notify("已触发 WhatsApp 重连", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.waLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/logout", { method: "POST" });
      await refreshIntegrationStatuses();
      notify("WhatsApp 已登出", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.waRefreshStatusBtn.addEventListener("click", refreshIntegrationStatuses);
  els.tgRefreshStatusBtn.addEventListener("click", refreshIntegrationStatuses);

  els.tgRequestCodeBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/telegram-userbot/request-code", {
        method: "POST",
        body: { phoneNumber: els.tgPhoneInput.value.trim() }
      });
      await refreshIntegrationStatuses();
      notify("已请求 Telegram 验证码", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.tgLoginBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/telegram-userbot/complete-login", {
        method: "POST",
        body: {
          phoneCode: els.tgCodeInput.value.trim(),
          password: els.tgPasswordInput.value
        }
      });
      await refreshIntegrationStatuses();
      notify("Telegram 登录流程已提交", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.tgLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/telegram-userbot/logout", { method: "POST" });
      await refreshIntegrationStatuses();
      notify("Telegram 已登出", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

function bindReceiptEvents() {
  els.recTarget.addEventListener("change", () => {
    state.selectedReceiptResourceId = els.recTarget.value;
    loadReceiptResource(state.selectedReceiptResourceId);
  });

  els.receiptCopyButton.addEventListener("click", async () => {
    try {
      await copyText(els.recText.value, "回执文本已复制");
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.receiptSendButton.addEventListener("click", async () => {
    try {
      const resourceId = els.recTarget.value;
      await api(`/api/actions/resources/${resourceId}/receipt`, {
        method: "POST",
        body: {
          text: els.recText.value,
          amount: Number(els.recAmt.value || 0),
          slipCount: Math.max(Number(els.recCount.value || 1) - 1, 0)
        }
      });
      notify("回执已发送", "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.copyMarketBtn.addEventListener("click", async () => {
    try {
      await copyText(els.inpMarket.value, "报价已复制");
    } catch (error) {
      notify(error.message, "red", true);
    }
  });

  els.buildSummaryBtn.addEventListener("click", async () => {
    try {
      await copyText(buildSummaryText(), "汇总已复制");
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

async function init() {
  renderPersistentControls();
  renderQuickReplies();
  renderCustomCommands();
  bindCoreInputs();
  bindResourceEvents();
  bindCommandEditorEvents();
  bindDiscoveryEvents();
  bindIntegrationEvents();
  bindReceiptEvents();

  socket.on("bootstrap", renderSnapshot);
  socket.on("snapshot", renderSnapshot);
  socket.on("connect", () => notify("Socket 已连接", "blue"));
  socket.on("disconnect", () => notify("Socket 已断开", "red", true));

  try {
    const snapshot = await api("/api/bootstrap");
    renderSnapshot(snapshot);
    await refreshIntegrationStatuses();
    await refreshRecentChats(false);
  } catch (error) {
    notify(error.message, "red", true);
  }

  setInterval(refreshIntegrationStatuses, 5000);
}

init();
