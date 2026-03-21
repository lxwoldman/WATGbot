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
  safetyLock: false,
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
  latestFeedbackMeta: null,
  latestSupplierRepriceText: "",
  latestSupplierRepriceMeta: null,
  americasAutoDisabled: {},
  lastResourcePresetKey: "",
  customCommands: defaultCustomCommands.map((item, index) => normalizeCommand(item, index)),
  resourceCurrencies: { ...legacySharedSettings.resourceCurrencies },
  exchangeRate: defaultConsoleSettings.exchangeRate,
  specialTarget: defaultConsoleSettings.specialTarget,
  followAmount: defaultConsoleSettings.followAmount,
  manualAmericas: defaultConsoleSettings.manualAmericas,
  safetyLock: defaultConsoleSettings.safetyLock,
  lastStableTicket: loadJson(storageKeys.stableTicket, null),
  receiptOddsManual: false,
  sharedSettingsHydrated: false,
  legacySettingsMigrated: false,
  consoleSettingsUnsupportedNotified: false,
  lastSafetyLockNoticeAt: 0,
  pendingConsoleSettingsPatch: {},
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
  targetAllocatedRmb: document.getElementById("targetAllocatedRmb"),
  effectiveTarget: document.getElementById("effectiveTarget"),
  effectiveTargetRmb: document.getElementById("effectiveTargetRmb"),
  targetGap: document.getElementById("targetGap"),
  targetGapRmb: document.getElementById("targetGapRmb"),
  gapBoxLabel: document.getElementById("gapBoxLabel"),
  targetHintText: document.getElementById("targetHintText"),
  gapBox: document.getElementById("gapBox"),
  safetyLockBadge: document.getElementById("safetyLockBadge"),
  safetyLockToggleBtn: document.getElementById("safetyLockToggleBtn"),
  resourceSelectAllBtn: document.getElementById("resourceSelectAllBtn"),
  resourceDeselectAllBtn: document.getElementById("resourceDeselectAllBtn"),
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

function isSafetyLockError(error) {
  return Number(error?.status) === 423 || /Safety lock/i.test(String(error?.message || ""));
}

function maybeNotifySafetyLock() {
  const now = Date.now();
  if (now - state.lastSafetyLockNoticeAt < 1200) {
    return;
  }
  state.lastSafetyLockNoticeAt = now;
  notify("安全锁已开启，先解锁再操作", "red", true);
}

function isSafetyLockBypassTarget(target) {
  return target instanceof Element && Boolean(target.closest("[data-lock-bypass='true']"));
}

function handleSafetyLockGuard(event) {
  if (!state.safetyLock || isSafetyLockBypassTarget(event.target)) {
    return;
  }

  const interactiveTarget =
    event.target instanceof Element
      ? event.target.closest("button, input, select, textarea, label, a, [role='button'], [contenteditable='true']")
      : null;

  if (!interactiveTarget) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  maybeNotifySafetyLock();
}

function renderSafetyLockState() {
  document.body.classList.toggle("safety-locked", Boolean(state.safetyLock));
  setBadge(els.safetyLockBadge, state.safetyLock ? "安全锁已开启" : "安全锁未开启", state.safetyLock ? "amber" : "");
  els.safetyLockToggleBtn.textContent = state.safetyLock ? "解除安全锁" : "开启安全锁";
  els.safetyLockToggleBtn.classList.toggle("danger", Boolean(state.safetyLock));

  if (state.safetyLock && document.activeElement instanceof HTMLElement && !isSafetyLockBypassTarget(document.activeElement)) {
    document.activeElement.blur();
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
    isAmericasOrder: isAmericasOrder(),
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

function stripLineOrdinal(line) {
  return String(line || "")
    .replace(/^\s*\d+\s*[.、)\-]\s*/, "")
    .trim();
}

function looksLikeTeamsLine(line) {
  return /\bv(?:s)?\b/i.test(String(line || ""));
}

function parseRawOdds(text) {
  const matches = [...String(text || "").matchAll(/[＠@]\s*([0-9]+(?:\.[0-9]+)?)/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}

function parseSourceMessage(text) {
  const lines = splitTextLines(text)
    .map((line) => stripLineOrdinal(line))
    .filter(Boolean);

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
  const hasTeams = Boolean(parsed.teams && looksLikeTeamsLine(parsed.teams));
  const hasStructuredMarket = Boolean(parsed.marketText && isStructuredMarketText(parsed.marketText));
  const hasConfirmationAmount = /确\s*\d+/i.test(String(text || ""));
  const isPrepTicket = Boolean(lines.length === 2 && parsed.league && hasTeams && !hasStructuredMarket);
  const isMarketTicket = Boolean(parsed.league && hasTeams && hasStructuredMarket && !hasConfirmationAmount);
  const isSourceReceipt = Boolean(parsed.league && hasTeams && hasStructuredMarket && hasConfirmationAmount);
  const messageType = isPrepTicket
    ? "prep_ticket"
    : isMarketTicket
      ? "market_ticket"
      : isSourceReceipt
        ? "source_receipt"
        : "chat";
  const feedbackSignal = messageType === "chat" ? extractFeedbackSignal(text) : null;
  const isStructuredTicket = messageType === "market_ticket";
  const isAutoExtractable = messageType === "prep_ticket" || messageType === "market_ticket";

  return {
    lines,
    parsed,
    messageType,
    isStructuredTicket,
    isAutoExtractable,
    feedbackSignal
  };
}

function buildTicketDraftFromSourceText(text, baseTicket = {}) {
  const sourceAnalysis = analyzeSourceMessage(text);
  if (sourceAnalysis.messageType !== "market_ticket") return null;

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
    isAmericasOrder: Boolean(ticket.isAmericasOrder),
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

  if (normalized.league && normalized.teams && !normalized.marketText) {
    return normalized;
  }

  if (
    sourceAnalysis?.messageType === "market_ticket" ||
    (sourceAnalysis?.messageType === "prep_ticket" && normalized.league && normalized.teams)
  ) {
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
    safetyLock: Boolean(settings.safetyLock ?? defaultConsoleSettings.safetyLock),
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
    Boolean(left.safetyLock) === Boolean(right.safetyLock) &&
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
  state.safetyLock = sharedSettings.safetyLock;
  state.resourceCurrencies = resolveResourceCurrencies(snapshot?.resources || []);
  state.sharedSettingsHydrated = true;
}

function buildConsoleSettingsPayload() {
  return {
    exchangeRate: state.exchangeRate,
    specialTarget: state.specialTarget,
    followAmount: state.followAmount,
    manualAmericas: state.manualAmericas,
    safetyLock: state.safetyLock,
    customCommands: state.customCommands.map((command) => ({
      id: command.id,
      label: command.label,
      text: command.text
    }))
  };
}

function applyConsoleSettingsPayload(settings) {
  const normalized = normalizeSharedSettings(settings || {});
  state.customCommands = normalized.customCommands;
  state.exchangeRate = normalized.exchangeRate;
  state.specialTarget = normalized.specialTarget;
  state.followAmount = normalized.followAmount;
  state.manualAmericas = normalized.manualAmericas;
  state.safetyLock = normalized.safetyLock;
  renderPersistentControls();
  renderCustomCommands();
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

async function persistConsoleSettingsNow(successText = "", patchOverride = null) {
  const payload = patchOverride || buildConsoleSettingsPayload();
  try {
    const updated = await api("/api/console-settings", {
      method: "PATCH",
      body: payload
    });
    applyConsoleSettingsPayload(updated);
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
  const patch = { ...state.pendingConsoleSettingsPatch };
  state.pendingConsoleSettingsPatch = {};

  if (!Object.keys(patch).length) {
    return;
  }

  if (state.safetyLock && !(Object.keys(patch).length === 1 && patch.safetyLock === false)) {
    return;
  }

  try {
    await persistConsoleSettingsNow("", patch);
  } catch (error) {
    notify(error.message, "red", true);
  }
}, 300);

function queueConsoleSettingsPatch(patch = {}) {
  state.pendingConsoleSettingsPatch = {
    ...state.pendingConsoleSettingsPatch,
    ...patch
  };
  scheduleConsoleSettingsSync();
}

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
          safetyLock: false,
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

function isResourceEnabled(row) {
  return row?.dataset.resourceEnabled !== "false";
}

function isResourceRowOperational(row) {
  if (!isResourceEnabled(row)) {
    return false;
  }
  return Boolean(
    row.querySelector(".resource-send")?.checked ||
      row.querySelector(".resource-allocate")?.checked ||
      row.querySelector(".resource-live")?.checked
  );
}

function isAmericasBlockedRow(row) {
  if (!isResourceEnabled(row)) {
    return false;
  }
  return Boolean(isAmericasOrder() && !row.querySelector(".resource-americas")?.checked);
}

function rememberAmericasAutoDisabledRow(row) {
  const resourceId = row.dataset.resourceId;
  if (!resourceId || state.americasAutoDisabled[resourceId]) return;

  state.americasAutoDisabled[resourceId] = {
    sendEnabled: Boolean(row.querySelector(".resource-send")?.checked),
    includeInAllocation: Boolean(row.querySelector(".resource-allocate")?.checked)
  };
}

function forgetAmericasAutoDisabledRow(resourceId) {
  if (!resourceId) return;
  delete state.americasAutoDisabled[resourceId];
}

function buildResourcePresetKey(league, teams) {
  const normalizedLeague = String(league || "").trim();
  const normalizedTeams = String(teams || "").trim();
  if (!normalizedLeague || !normalizedTeams) {
    return "";
  }
  return `${normalizedLeague}||${normalizedTeams}||${isAmericasLeague(normalizedLeague) ? "americas" : "regular"}`;
}

function applyResourcePresetForCurrentOrder(league, teams) {
  if (state.safetyLock) {
    return;
  }
  const presetKey = buildResourcePresetKey(league, teams);
  if (!presetKey || presetKey === state.lastResourcePresetKey) {
    return;
  }

  state.lastResourcePresetKey = presetKey;
  const americasOrder = isAmericasLeague(league);
  const rows = Array.from(els.resourceContainer.querySelectorAll(".rc-row"));

  rows.forEach((row) => {
    const resourceId = row.dataset.resourceId;
    const sendInput = row.querySelector(".resource-send");
    const allocationInput = row.querySelector(".resource-allocate");
    const liveDispatchInput = row.querySelector(".resource-live");
    const canAmericasInput = row.querySelector(".resource-americas");
    if (!resourceId || !sendInput || !allocationInput) return;
    if (!isResourceEnabled(row)) {
      updateResourceRowState(row);
      return;
    }

    const isLiveDispatch = Boolean(liveDispatchInput?.checked);
    const canAmericas = Boolean(canAmericasInput?.checked);
    const nextSend = isLiveDispatch ? false : americasOrder ? canAmericas : true;
    const nextAllocate = isLiveDispatch ? !americasOrder || canAmericas : americasOrder ? canAmericas : true;

    const changed = sendInput.checked !== nextSend || allocationInput.checked !== nextAllocate;
    sendInput.checked = nextSend;
    allocationInput.checked = nextAllocate;
    updateResourceRowState(row);

    if (changed) {
      scheduleResourceSync(resourceId, collectResourcePatch(row));
    }
  });
}

function updateResourceRowState(row) {
  const sendInput = row.querySelector(".resource-send");
  const allocationInput = row.querySelector(".resource-allocate");
  const liveDispatchInput = row.querySelector(".resource-live");
  const americasInput = row.querySelector(".resource-americas");
  const amountInput = row.querySelector(".resource-amount");
  const currencyInput = row.querySelector(".resource-currency");
  const slipInput = row.querySelector(".resource-slip");
  const typeInput = row.querySelector(".resource-type");
  const nameInput = row.querySelector(".resource-name");
  const bindInput = row.querySelector(".resource-bind");
  const actionButtons = row.querySelectorAll("button[data-resource-action]");
  const resourceEnabled = isResourceEnabled(row);
  const isLiveDispatch = Boolean(liveDispatchInput?.checked);
  const isAmericasBlocked = isAmericasBlockedRow(row);

  if (!resourceEnabled) {
    row.classList.add("inactive", "disabled");
    row.classList.remove("live-dispatch");
    [
      sendInput,
      allocationInput,
      liveDispatchInput,
      americasInput,
      amountInput,
      currencyInput,
      slipInput,
      typeInput,
      nameInput,
      bindInput
    ].forEach((element) => {
      if (element) {
        element.disabled = true;
      }
    });
    actionButtons.forEach((button) => {
      button.disabled = button.dataset.resourceAction !== "toggle-enabled";
    });
    return;
  }

  [
    sendInput,
    liveDispatchInput,
    americasInput,
    amountInput,
    currencyInput,
    slipInput,
    typeInput,
    nameInput,
    bindInput
  ].forEach((element) => {
    if (element) {
      element.disabled = false;
    }
  });
  actionButtons.forEach((button) => {
    button.disabled = false;
  });

  if (allocationInput) {
    if (isLiveDispatch && !isAmericasBlocked) {
      allocationInput.checked = true;
    } else if (isLiveDispatch && isAmericasBlocked) {
      allocationInput.checked = false;
    }
  }
  if (isLiveDispatch && sendInput) {
    sendInput.checked = false;
  }

  const enabled = isResourceRowOperational(row);
  row.classList.remove("inactive");
  row.classList.toggle("disabled", !enabled);
  row.classList.toggle("live-dispatch", isLiveDispatch);
  if (amountInput) {
    amountInput.disabled = !enabled;
  }
  if (allocationInput) {
    allocationInput.disabled = Boolean(
      isLiveDispatch ||
        (!sendInput?.checked && !liveDispatchInput?.checked && isAmericasBlocked)
    );
  }
}

function collectResourcePatch(row) {
  const liveDispatch = Boolean(row.querySelector(".resource-live")?.checked);
  const includeInAllocation = liveDispatch
    ? !isAmericasBlockedRow(row)
    : Boolean(row.querySelector(".resource-allocate")?.checked);
  return {
    name: row.querySelector(".resource-name")?.value.trim() || "",
    remoteId: row.querySelector(".resource-bind")?.value.trim() || "",
    enabled: isResourceEnabled(row),
    sendEnabled: liveDispatch ? false : Boolean(row.querySelector(".resource-send")?.checked),
    includeInAllocation,
    liveDispatch,
    canAmericas: Boolean(row.querySelector(".resource-americas")?.checked),
    amount: Number(row.querySelector(".resource-amount")?.value || 0),
    slipCount: Number(row.querySelector(".resource-slip")?.value || 0),
    allocationType: row.querySelector(".resource-type")?.value || "fixed",
    currency: row.querySelector(".resource-currency")?.value === "RMB" ? "RMB" : "U"
  };
}

function applyAmericasConstraints() {
  if (state.safetyLock) {
    return;
  }
  const americasOrder = isAmericasOrder();

  document.querySelectorAll(".rc-row").forEach((row) => {
    const sendInput = row.querySelector(".resource-send");
    const allocationInput = row.querySelector(".resource-allocate");
    const canAmericasInput = row.querySelector(".resource-americas");
    if (!sendInput || !allocationInput || !canAmericasInput) return;
    if (!isResourceEnabled(row)) {
      updateResourceRowState(row);
      return;
    }
    const resourceId = row.dataset.resourceId;

    if (americasOrder && !canAmericasInput.checked && (sendInput.checked || allocationInput.checked)) {
      rememberAmericasAutoDisabledRow(row);
      sendInput.checked = false;
      allocationInput.checked = false;
      if (resourceId) {
        scheduleResourceSync(resourceId, collectResourcePatch(row));
      }
    }

    if (!americasOrder && resourceId && state.americasAutoDisabled[resourceId]) {
      const previous = state.americasAutoDisabled[resourceId];
      if (!row.querySelector(".resource-live")?.checked) {
        sendInput.checked = previous.sendEnabled;
      }
      allocationInput.checked = previous.includeInAllocation;
      forgetAmericasAutoDisabledRow(resourceId);
      scheduleResourceSync(resourceId, collectResourcePatch(row));
    }

    updateResourceRowState(row);
  });
}

function renderTargetHint(effectiveTarget, allocated, gap, over) {
  const targetBaseText = isAmericasOrder()
    ? `特殊赛额度 + 跟注额 = ${formatMoney(effectiveTarget)} USD`
    : `常规赛额度 + 跟注额 = ${formatMoney(effectiveTarget)} USD`;

  if (over > 0) {
    els.targetHintText.textContent = `${targetBaseText}，超出 ${formatMoney(over)} USD`;
    return;
  }

  if (gap > 0) {
    els.targetHintText.textContent = `${targetBaseText}，缺口 ${formatMoney(gap)} USD`;
    return;
  }

  els.targetHintText.textContent = `${targetBaseText}，已分配 ${formatMoney(allocated)} USD`;
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
    if (!isResourceEnabled(row)) return;
    if (!row.querySelector(".resource-allocate")?.checked) return;
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
  const over = Math.max(allocated - effectiveTarget, 0);
  const exchangeRate = getExchangeRateValue();
  const effectiveTargetRmb = effectiveTarget * exchangeRate;
  const allocatedRmb = allocated * exchangeRate;
  const gapRmb = gap * exchangeRate;
  const overRmb = over * exchangeRate;
  const displayGap = over > 0 ? over : gap;
  const displayGapRmb = over > 0 ? overRmb : gapRmb;

  els.targetAllocated.textContent = `${formatMoney(allocated)}U`;
  els.targetAllocated.dataset.usd = String(allocated);
  if (els.targetAllocatedRmb) {
    els.targetAllocatedRmb.textContent = `${formatMoney(allocatedRmb)}R`;
  }
  els.effectiveTarget.textContent = `${formatMoney(effectiveTarget)}U`;
  els.effectiveTarget.dataset.usd = String(effectiveTarget);
  if (els.effectiveTargetRmb) {
    els.effectiveTargetRmb.textContent = `${formatMoney(effectiveTargetRmb)}R`;
  }
  if (els.gapBoxLabel) {
    els.gapBoxLabel.textContent = over > 0 ? "超出额度" : "未分配缺口";
  }
  els.targetGap.textContent = `${formatMoney(displayGap)}U`;
  els.targetGap.dataset.usd = String(displayGap);
  if (els.targetGapRmb) {
    els.targetGapRmb.textContent = `${formatMoney(displayGapRmb)}R`;
  }
  els.sumConfirmed.textContent = `已分配: ${formatMoney(allocated)}U`;
  if (over > 0) {
    els.gapBox.className = "data-box over-alert";
    els.gapBox.style.background = "";
    els.gapBox.style.borderColor = "";
  } else if (gap > 0) {
    els.gapBox.className = "data-box gap-alert";
    els.gapBox.style.background = "";
    els.gapBox.style.borderColor = "";
  } else {
    els.gapBox.className = "data-box";
    els.gapBox.style.background = "#f0f9eb";
    els.gapBox.style.borderColor = "#e1f3d8";
  }
  renderTargetHint(effectiveTarget, allocated, gap, over);

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

  const orderedResources = resources
    .map((resource, index) => ({ resource, index }))
    .sort((left, right) => {
      const leftEnabled = left.resource.enabled !== false;
      const rightEnabled = right.resource.enabled !== false;
      if (leftEnabled === rightEnabled) {
        return left.index - right.index;
      }
      return leftEnabled ? -1 : 1;
    })
    .map((entry) => entry.resource);

  const html = orderedResources
    .map((resource) => {
      const inactive = resource.enabled === false;
      const disabled = inactive || (!resource.sendEnabled && !resource.includeInAllocation && !resource.liveDispatch);
      const currency = getResourceCurrency(resource.id);
      return `
        <div class="rc-row${disabled ? " disabled" : ""}${inactive ? " inactive" : ""}${resource.liveDispatch && !inactive ? " live-dispatch" : ""}" data-resource-id="${resource.id}" data-resource-enabled="${inactive ? "false" : "true"}">
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
            }> 发送</label>
            <label><input type="checkbox" class="resource-allocate" ${
              resource.includeInAllocation ? "checked" : ""
            }> 计额</label>
            <label><input type="checkbox" class="resource-live" ${
              resource.liveDispatch ? "checked" : ""
            }> 连麦</label>
            <label><input type="checkbox" class="resource-americas" ${
              resource.canAmericas ? "checked" : ""
            }> 美洲</label>
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
            <button data-resource-action="toggle-enabled" class="toggle ${inactive ? "enable" : "disable"}">${inactive ? "启用" : "停用"}</button>
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
  els.recTarget.innerHTML = orderedResources
    .map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)}</option>`)
    .join("");

  if (!orderedResources.some((item) => item.id === state.selectedReceiptResourceId)) {
    state.selectedReceiptResourceId = orderedResources[0]?.id || "";
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
  const detailText = options.detailText || "";

  box.classList.toggle("empty", !hasValue);
  textElement.innerHTML = `<span class="feedback-title">${escapeHtml(title)}</span><b>${escapeHtml(value)}</b>${
    detailText ? `<span class="feedback-detail">${escapeHtml(detailText)}</span>` : ""
  }`;
  buttonElement.disabled = !hasValue;
  buttonElement.textContent = hasValue ? `${actionText} ${value}` : idleText;
}

function formatFeedbackTime(at) {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatFeedbackSourceLabel(candidate) {
  if (!candidate) return "";
  if (candidate.roleHint === "resource") {
    return candidate.resourceName || candidate.resourceId || candidate.remoteId || "资源";
  }
  if (candidate.roleHint === "supplier") {
    return candidate.sourceChannelLabel || candidate.sourceChannelId || candidate.remoteId || "源头";
  }
  return candidate.remoteId || candidate.platform || "";
}

function buildFeedbackCandidates(snapshot) {
  const inboundMessages = Array.isArray(snapshot?.inboundMessages) ? snapshot.inboundMessages : [];
  const candidates = inboundMessages
    .map((message, index) => {
      const text = String(message?.text || "").trim();
      if (!text) return null;
      if (analyzeSourceMessage(text).messageType !== "chat") {
        return null;
      }

      const signal = extractFeedbackSignal(text);
      if (!signal) return null;

      const resource = message.resourceId ? getResourceById(message.resourceId) : null;
      const sourceChannel = message.sourceChannelId ? getSourceChannelById(message.sourceChannelId) : null;
      let score = Number(signal.score || 0) + Math.max(0, 30 - index);
      if (message.roleHint === "resource") score += 12;
      if (message.roleHint === "supplier") score += 8;
      if (message.sourceChannelId && message.sourceChannelId === state.selectedSourceId) score += 4;

      return {
        signalText: signal.text,
        signalPrice: signal.price,
        resourceId: message.resourceId || "",
        resourceName: resource?.name || "",
        sourceChannelId: message.sourceChannelId || "",
        sourceChannelLabel: sourceChannel?.label || "",
        remoteId: message.remoteId || "",
        at: message.at || "",
        roleHint: message.roleHint || "",
        platform: message.platform || "",
        score
      };
    })
    .filter(Boolean);

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(right.at || 0) - Date.parse(left.at || 0);
  });

  return candidates;
}

function renderSupplierFeedback(snapshot) {
  const candidate =
    buildFeedbackCandidates(snapshot).find((item) => item.roleHint === "resource") || null;
  state.latestFeedbackPrice = candidate?.signalText || "";
  state.latestFeedbackMeta = candidate;

  renderFeedbackBox(els.supplierFeedbackBox, els.supplierFeedbackText, els.supplierFeedbackBtn, {
    title: "下游反馈",
    value: candidate?.signalText || "",
    detailText: candidate ? `${formatFeedbackSourceLabel(candidate)} · ${formatFeedbackTime(candidate.at)}` : "",
    actionText: "向供应商反馈",
    idleText: "等待下游反馈"
  });
}

function renderResourceReprice(snapshot) {
  const currentSourceId = state.snapshot?.currentTicket?.sourceChannelId || "";
  const candidates = buildFeedbackCandidates(snapshot);
  const candidate =
    candidates.find(
      (item) => item.roleHint === "supplier" && (!currentSourceId || item.sourceChannelId === currentSourceId)
    ) ||
    candidates.find((item) => item.roleHint === "supplier") ||
    null;
  const repriceText = candidate?.signalText || "";
  state.latestSupplierRepriceText = repriceText;
  state.latestSupplierRepriceMeta = candidate;

  renderFeedbackBox(els.resourceRepriceBox, els.resourceRepriceText, els.resourceRepriceBtn, {
    title: "源头反馈",
    value: repriceText,
    detailText: candidate ? `${formatFeedbackSourceLabel(candidate)} · ${formatFeedbackTime(candidate.at)}` : "",
    actionText: "向资源同步",
    idleText: "等待源头反馈"
  });
}

function syncAmericasFlagFromLeague(league, { persist = false } = {}) {
  if (state.safetyLock) {
    return;
  }
  const nextValue = isAmericasLeague(league);
  state.manualAmericas = nextValue;
  els.americasOrderCheckbox.checked = nextValue;
  if (persist) {
    queueConsoleSettingsPatch({ manualAmericas: nextValue });
  }
}

async function extractSourceMessageToConsole({ toast = true } = {}) {
  if (state.safetyLock) {
    maybeNotifySafetyLock();
    return;
  }
  const text = state.snapshot?.currentTicket?.sourceMessage?.text || "";
  const sourceAnalysis = analyzeSourceMessage(text);
  const parsed = sourceAnalysis.parsed;

  if (!sourceAnalysis.isAutoExtractable) {
    if (toast) {
      const message =
        sourceAnalysis.messageType === "source_receipt"
          ? "当前消息更像源头回单/确认，不覆盖中控台"
          : "当前消息更像反馈/聊天，已保留上一张有效单，不覆盖中控台";
      notify(message, "red", true);
    }
    return;
  }

  els.inpLeague.value = parsed.league;
  els.inpTeam.value = parsed.teams;
  syncAmericasFlagFromLeague(parsed.league, { persist: true });
  applyResourcePresetForCurrentOrder(parsed.league, parsed.teams);
  if (sourceAnalysis.messageType === "prep_ticket") {
    els.inpMarket.value = "";
    els.oddsRaw.value = "";
    state.receiptOddsManual = false;
    els.recOdds.value = "";
  } else {
    els.inpMarket.value = parsed.marketText;
  }
  if (sourceAnalysis.messageType === "market_ticket" && parsed.rawOdds) {
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
  renderSafetyLockState();
}

function renderSnapshot(snapshot) {
  const previousFingerprint = state.lastSourceFingerprint;
  state.snapshot = snapshot;
  applySharedSettings(snapshot);
  const ticket = snapshot.currentTicket || {};
  const sourceAnalysis = analyzeSourceMessage(ticket.sourceMessage?.text || "");
  const displayTicket = getProtectedConsoleTicket(ticket, sourceAnalysis, snapshot.logs || []);
  state.manualAmericas = Boolean(ticket.isAmericasOrder ?? state.manualAmericas);
  renderPersistentControls();
  renderSourceChannels(snapshot);
  renderResources(snapshot.resources || []);
  renderSupplierFeedback(snapshot);
  renderResourceReprice(snapshot);

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

  applyResourcePresetForCurrentOrder(displayTicket.league, displayTicket.teams);
  calculateLocal();

  const sourceFingerprint = `${ticket.sourceChannelId || ""}|${ticket.sourceMessage?.arrivedAt || ""}|${
    ticket.sourceMessage?.text || ""
  }`;
  if (ticket.sourceMessage?.text && sourceFingerprint !== previousFingerprint) {
    state.lastSourceFingerprint = sourceFingerprint;
    if (state.safetyLock) {
      notify("安全锁开启中：检测到新消息，待手动提取", "amber", true);
    } else if (sourceAnalysis.isAutoExtractable) {
      void extractSourceMessageToConsole({ toast: false });
    }
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
    if (state.safetyLock && isSafetyLockError(error)) {
      return;
    }
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
      if (state.safetyLock && isSafetyLockError(error)) {
        return;
      }
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
      enabled: isResourceEnabled(row),
      autoSend: Boolean(row.querySelector(".resource-send")?.checked),
      included: Boolean(row.querySelector(".resource-allocate")?.checked),
      liveDispatch: Boolean(row.querySelector(".resource-live")?.checked),
      amount,
      currency,
      usdAmount: toUsd(amount, currency),
      remoteId: row.querySelector(".resource-bind")?.value || ""
    };
  });

  const countedResources = resources.filter((item) => item.enabled && item.included);
  const total = countedResources.reduce((sum, item) => sum + item.usdAmount, 0);

  return [
    `单号: ${state.snapshot?.currentTicket?.id || "--"}`,
    `品类: ${ticket.league}`,
    `品牌: ${ticket.teams}`,
    `报价: ${ticket.marketText}`,
    `回执水位: ${els.oddsFinal.value}`,
    `总目标: ${formatMoney(Number(els.effectiveTarget.dataset.usd || 0))}U`,
    `已分配: ${formatMoney(total)}U`,
    "分销商明细:",
    ...countedResources.map(
      (item) =>
        `- ${item.name} | ${item.amount}${item.currency} | 折合 ${formatMoney(item.usdAmount)}U | ${
          item.liveDispatch ? "连麦" : item.autoSend ? "自动发送" : "仅计额"
        } | ${item.remoteId || "未绑定"}`
    )
  ].join("\n");
}

async function copyText(text, successText) {
  await navigator.clipboard.writeText(text);
  notify(successText, "blue", true);
}

function formatDispatchSummary(result, successLabel = "已发送") {
  if (!result) {
    return successLabel;
  }
  if (!result.total) {
    return "当前没有可发送的资源";
  }
  if (!result.failed) {
    return `${successLabel} ${result.sent}/${result.total}`;
  }
  return `部分发送成功：成功 ${result.sent}，失败 ${result.failed}`;
}

function buildDispatchFailureDetail(result) {
  if (!result?.failed) {
    return "";
  }
  const failedNames = (result.items || [])
    .filter((item) => item.status === "failed")
    .map((item) => item.resourceName || item.resourceId)
    .filter(Boolean)
    .slice(0, 6);

  return failedNames.length ? `；失败资源：${failedNames.join("、")}` : "";
}

function notifyDispatchResult(result, successLabel = "已发送") {
  const message = `${formatDispatchSummary(result, successLabel)}${buildDispatchFailureDetail(result)}`;
  notify(message, result?.failed ? "red" : "blue", true);
}

async function sendBroadcastCustom(text, successText = "已发送") {
  const result = await api("/api/actions/broadcast-custom", {
    method: "POST",
    body: { text }
  });
  notifyDispatchResult(result, successText);
  return result;
}

async function sendPrepBroadcast() {
  const league = els.inpLeague.value.trim();
  const teams = els.inpTeam.value.trim();
  if (!league || !teams) {
    notify("预备单至少需要品类和品牌两行内容", "red", true);
    return;
  }

  return await sendBroadcastCustom(`${league}\n${teams}`, "预备单已发送");
}

function bindSafetyLockEvents() {
  ["click", "dblclick", "input", "change", "beforeinput", "paste", "drop"].forEach((eventName) => {
    document.addEventListener(eventName, handleSafetyLockGuard, true);
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!state.safetyLock || isSafetyLockBypassTarget(event.target)) {
        return;
      }

      const interactiveTarget =
        event.target instanceof Element
          ? event.target.closest("input, select, textarea, [contenteditable='true'], button")
          : null;

      if (!interactiveTarget) {
        return;
      }

      handleSafetyLockGuard(event);
    },
    true
  );

  els.safetyLockToggleBtn.addEventListener("click", async () => {
    const nextLockState = !state.safetyLock;
    const previousLockState = state.safetyLock;
    state.safetyLock = nextLockState;
    renderSafetyLockState();

    try {
      const saved = await persistConsoleSettingsNow(nextLockState ? "安全锁已开启" : "安全锁已解除", {
        safetyLock: nextLockState
      });
      if (saved === false) {
        state.safetyLock = previousLockState;
        renderSafetyLockState();
      }
    } catch (error) {
      state.safetyLock = previousLockState;
      renderSafetyLockState();
      notify(error.message, "red", true);
    }
  });
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
    queueConsoleSettingsPatch({ exchangeRate: state.exchangeRate });
  });

  els.specialTarget.addEventListener("input", () => {
    state.specialTarget = getSpecialTargetValue();
    calculateLocal();
    queueConsoleSettingsPatch({ specialTarget: state.specialTarget });
  });

  els.followAmount.addEventListener("input", () => {
    state.followAmount = getFollowAmountValue();
    calculateLocal();
    queueConsoleSettingsPatch({ followAmount: state.followAmount });
  });

  els.americasOrderCheckbox.addEventListener("change", () => {
    state.manualAmericas = els.americasOrderCheckbox.checked;
    calculateLocal();
    queueConsoleSettingsPatch({ manualAmericas: state.manualAmericas });
    syncTicket();
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
      const result = await api("/api/actions/broadcast-market", { method: "POST" });
      notifyDispatchResult(result, "报价已发送");
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
  function toggleAllResources(enabled) {
    const rows = Array.from(els.resourceContainer.querySelectorAll(".rc-row"));
    let skippedLiveDispatch = 0;
    let skippedInactive = 0;

    rows.forEach((row) => {
      const sendInput = row.querySelector(".resource-send");
      const allocationInput = row.querySelector(".resource-allocate");
      const liveDispatchInput = row.querySelector(".resource-live");
      const canAmericasInput = row.querySelector(".resource-americas");
      if (!sendInput) return;
      if (!isResourceEnabled(row)) {
        skippedInactive += 1;
        updateResourceRowState(row);
        return;
      }

      const nextEnabled =
        enabled &&
        !Boolean(liveDispatchInput?.checked) &&
        (!isAmericasOrder() || Boolean(canAmericasInput?.checked));

      if (enabled && liveDispatchInput?.checked) {
        skippedLiveDispatch += 1;
      }

      sendInput.checked = nextEnabled;
      if (enabled && allocationInput && !liveDispatchInput?.checked) {
        allocationInput.checked = nextEnabled;
      }
      updateResourceRowState(row);

      const resourceId = row.dataset.resourceId;
      if (resourceId) {
        scheduleResourceSync(resourceId, collectResourcePatch(row));
      }
    });

    calculateLocal();
    const message = enabled
      ? skippedLiveDispatch
        ? `已全选自动发送资源，保留 ${skippedLiveDispatch} 个连麦客户不自动发送${skippedInactive ? `，跳过 ${skippedInactive} 个停用资源` : ""}`
        : "已全选自动发送资源"
      : skippedInactive
        ? `已取消全选自动发送资源，保留 ${skippedInactive} 个停用资源`
        : "已取消全选自动发送资源";
    notify(message, "blue", true);
  }

  els.resourceSelectAllBtn.addEventListener("click", () => {
    toggleAllResources(true);
  });

  els.resourceDeselectAllBtn.addEventListener("click", () => {
    toggleAllResources(false);
  });

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

    if (event.target.matches(".resource-live")) {
      const sendInput = row.querySelector(".resource-send");
      const allocateInput = row.querySelector(".resource-allocate");
      if (event.target.checked) {
        if (sendInput) {
          sendInput.checked = false;
        }
        if (allocateInput) {
          allocateInput.checked = true;
        }
      }
    }

    if (event.target.matches(".resource-send")) {
      const liveDispatchInput = row.querySelector(".resource-live");
      if (event.target.checked && liveDispatchInput?.checked) {
        liveDispatchInput.checked = false;
      }
    }

    if (
      event.target.matches(".resource-send") ||
      event.target.matches(".resource-allocate") ||
      event.target.matches(".resource-live") ||
      event.target.matches(".resource-americas")
    ) {
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
    if (action === "toggle-enabled") {
      const nextEnabled = !isResourceEnabled(row);
      row.dataset.resourceEnabled = nextEnabled ? "true" : "false";
      updateResourceRowState(row);

      if (state.snapshot?.resources) {
        state.snapshot.resources = state.snapshot.resources.map((resource) =>
          resource.id === resourceId ? { ...resource, ...collectResourcePatch(row) } : resource
        );
        renderResources(state.snapshot.resources);
      }

      scheduleResourceSync(resourceId, collectResourcePatch(row));
      calculateLocal();
      notify(nextEnabled ? "已启用资源" : "已停用资源", "blue", true);
      return;
    }

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
      const saved = await persistConsoleSettingsNow("快捷指令已保存", {
        customCommands: state.customCommands
      });
      if (saved === false) {
        return;
      }
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
  bindSafetyLockEvents();
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
