const quickReplies = ["0 (已阅)", "1 (就位)", "取消"];

const state = {
  snapshot: null,
  selectedSourceId: null,
  selectedReceiptResourceId: null,
  selectedRecentChatKey: "",
  recentChats: [],
  resourceSyncTimers: {},
  lastSourceFingerprint: "",
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
  ticketIdBadge: document.getElementById("ticketIdBadge"),
  inpLeague: document.getElementById("inpLeague"),
  inpTeam: document.getElementById("inpTeam"),
  inpMarket: document.getElementById("inpMarket"),
  oddsRaw: document.getElementById("oddsRaw"),
  oddsRebate: document.getElementById("oddsRebate"),
  oddsFinal: document.getElementById("oddsFinal"),
  targetTotal: document.getElementById("targetTotal"),
  targetAllocated: document.getElementById("targetAllocated"),
  targetGap: document.getElementById("targetGap"),
  gapBox: document.getElementById("gapBox"),
  sumConfirmed: document.getElementById("sumConfirmed"),
  resourceContainer: document.getElementById("resourceContainer"),
  recTarget: document.getElementById("recTarget"),
  recAmt: document.getElementById("recAmt"),
  recCount: document.getElementById("recCount"),
  recOdds: document.getElementById("recOdds"),
  recText: document.getElementById("recText"),
  receiptSendButton: document.getElementById("receiptSendButton"),
  receiptCopyButton: document.getElementById("receiptCopyButton"),
  alertText: document.getElementById("alertText"),
  alertActionBtn: document.getElementById("alertActionBtn"),
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
    throw new Error(payload?.error?.message || `Request failed: ${response.status}`);
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

function calculateLocal() {
  const raw = Number(els.oddsRaw.value || 0);
  const rebate = Number(els.oddsRebate.value || 0);
  const finalOdds = Math.max(raw - rebate, 0).toFixed(2);
  els.oddsFinal.value = finalOdds;
  els.recOdds.value = finalOdds;

  let allocated = 0;
  document.querySelectorAll(".rc-row").forEach((row) => {
    if (row.classList.contains("disabled")) return;
    allocated += Number(row.querySelector(".resource-amount")?.value || 0);
  });

  const target = Number(els.targetTotal.value || 0);
  const gap = Math.max(target - allocated, 0);
  els.targetAllocated.value = allocated;
  els.targetGap.value = gap;
  els.sumConfirmed.textContent = `已分配: ${allocated}U`;
  els.gapBox.className = gap > 0 ? "data-box gap-alert" : "data-box";
  els.gapBox.style.background = gap > 0 ? "" : "#f0f9eb";
  els.gapBox.style.borderColor = gap > 0 ? "" : "#e1f3d8";

  updateReceiptText();
}

function updateReceiptText() {
  const count = els.recCount.value;
  const league = els.inpLeague.value;
  const team = els.inpTeam.value;
  const marketClean = els.inpMarket.value.split("@")[0].trim();
  const finalOdds = els.recOdds.value;
  const amt = els.recAmt.value;
  els.recText.value = `${count}.${league}\n${team}\n${marketClean} @ ${finalOdds}确${amt}`;
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

function renderQuickReplies() {
  els.quickReplyContainer.innerHTML = quickReplies
    .map((reply, index) => {
      const tone =
        reply.includes("取消") ? " danger" : index === quickReplies.length - 1 ? " primary" : "";
      const spanStyle = quickReplies.length % 2 === 1 && index === quickReplies.length - 1 ? "grid-column: span 2;" : "";
      return `<button class="btn${tone}" data-quick-reply="${escapeHtml(reply)}" style="${spanStyle}">${escapeHtml(reply)}</button>`;
    })
    .join("");
}

function renderSourceChannels(snapshot) {
  const channels = snapshot.sourceChannels || [];
  const fallbackId = snapshot.currentTicket?.sourceChannelId || channels[0]?.id || "";
  if (!channels.some((item) => item.id === state.selectedSourceId)) {
    state.selectedSourceId = fallbackId;
  }

  const optionHtml = channels.length
    ? channels
        .map((channel) => `<option value="${channel.id}">${escapeHtml(channel.label)}${channel.note ? ` · ${escapeHtml(channel.note)}` : ""}</option>`)
        .join("")
    : "<option value=''>暂无供应商</option>";

  if (els.sourceChannelSelect.innerHTML !== optionHtml) {
    els.sourceChannelSelect.innerHTML = optionHtml;
  }
  els.sourceChannelSelect.value = state.selectedSourceId || "";

  const selected = channels.find((item) => item.id === state.selectedSourceId) || null;
  setBadge(els.sourceOnlineBadge, selected?.online ? "在线" : channels.length ? "离线" : "未绑定", selected?.online ? "blue" : selected ? "red" : "");
  els.sourceDeleteBtn.disabled = !selected;
}

function renderResources(resources) {
  if (!resources.length) {
    els.resourceContainer.innerHTML = "<div class='ops-note'>暂无分销商绑定，请先在左侧“发现与绑定”中新增。</div>";
    els.recTarget.innerHTML = "<option value=''>暂无资源</option>";
    return;
  }

  const html = resources
    .map((resource) => {
      const disabled = !resource.sendEnabled;
      return `
        <div class="rc-row${disabled ? " disabled" : ""}" data-resource-id="${resource.id}">
          <div class="rc-id">
            <input class="name resource-name" value="${escapeHtml(resource.name || "")}">
            <input class="bind resource-bind" value="${escapeHtml(resource.remoteId || "")}" placeholder="${escapeHtml(resource.bindingLabel || "remoteId / jid")}" title="${escapeHtml(resource.note || resource.bindingLabel || "")}">
          </div>
          <div class="rc-chk">
            <label><input type="checkbox" class="resource-send" ${resource.sendEnabled ? "checked" : ""}> 可发送</label>
            <label><input type="checkbox" class="resource-americas" ${resource.canAmericas ? "checked" : ""}> 可美洲</label>
          </div>
          <div class="rc-amt">
            <input type="number" class="resource-amount" value="${resource.amount ?? 0}" ${disabled ? "disabled" : ""}>
          </div>
          <div class="rc-cfg">
            <input type="number" class="resource-slip" value="${resource.slipCount ?? 0}">
            <select class="resource-type">
              <option value="fixed" ${resource.allocationType === "fixed" ? "selected" : ""}>固定</option>
              <option value="floating" ${resource.allocationType === "floating" ? "selected" : ""}>浮动</option>
            </select>
          </div>
          <div class="rc-btn">
            <button data-resource-action="market">盘口</button>
            <button data-resource-action="receipt">回执</button>
            <button data-resource-action="prep">预备</button>
            <button data-resource-action="delete" class="delete">删</button>
          </div>
        </div>
      `;
    })
    .join("");

  els.resourceContainer.innerHTML = html;
  els.recTarget.innerHTML = resources.map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)}</option>`).join("");

  if (!resources.some((item) => item.id === state.selectedReceiptResourceId)) {
    state.selectedReceiptResourceId = resources[0]?.id || "";
  }
  if (state.selectedReceiptResourceId) {
    els.recTarget.value = state.selectedReceiptResourceId;
    loadReceiptResource(state.selectedReceiptResourceId);
  }
}

function renderRecentChats() {
  const platform = els.bindPlatformSelect.value;
  const filtered = state.recentChats.filter((chat) => platform === "all" || chat.platform === platform);
  setBadge(els.bindScopeBadge, `${filtered.length} 个会话`, "blue");

  const optionHtml = filtered.length
    ? filtered
        .map((chat) => {
          const key = `${chat.platform}::${chat.remoteId}`;
          return `<option value="${escapeHtml(key)}">${escapeHtml(formatRecentChatLabel(chat))}</option>`;
        })
        .join("")
    : "<option value=''>暂无最近会话</option>";

  els.bindDiscoverySelect.innerHTML = optionHtml;
  if (!filtered.some((chat) => `${chat.platform}::${chat.remoteId}` === state.selectedRecentChatKey)) {
    state.selectedRecentChatKey = filtered[0] ? `${filtered[0].platform}::${filtered[0].remoteId}` : "";
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
        ? `最近活动: ${new Date(selected.lastMessageAt).toLocaleString("zh-CN", { hour12: false })}`
        : "最近活动: 未知"
    ].join(" | ");
  } else {
    els.bindMetaText.textContent = "先拉取最近会话，再选择身份并绑定。";
  }
}

function renderAlert(snapshot) {
  const hit = (snapshot.logs || []).find((log) => /收到 .*消息:.*?(\d+\.\d+)/.test(log.message));
  const price = hit?.message?.match(/(\d+\.\d+)/)?.[1];
  if (!price) {
    els.alertText.textContent = "⚠️ 暂无掉水告警";
    return;
  }

  els.alertText.innerHTML = `⚠️ 系统监听到价格反馈<br>当前水位 <b>${price}</b>`;
}

async function extractSourceMessageToConsole({ toast = true } = {}) {
  const text = state.snapshot?.currentTicket?.sourceMessage?.text || "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    notify("当前没有可提取的供应商消息", "red", toast);
    return;
  }

  const league = lines[0] || "";
  const teams = lines[1] || "";
  const marketText = lines.slice(2).join(" / ");

  els.inpLeague.value = league;
  els.inpTeam.value = teams;
  els.inpMarket.value = marketText;
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

function renderSnapshot(snapshot) {
  const previousFingerprint = state.lastSourceFingerprint;
  state.snapshot = snapshot;
  renderSourceChannels(snapshot);
  renderResources(snapshot.resources || []);
  renderAlert(snapshot);

  const ticket = snapshot.currentTicket || {};
  setBadge(els.ticketIdBadge, `单号 ${ticket.id || "--"}`);
  els.inpLeague.value = ticket.league || "";
  els.inpTeam.value = ticket.teams || "";
  els.inpMarket.value = ticket.marketText || "";
  els.oddsRaw.value = ticket.rawOdds ?? 0;
  els.oddsRebate.value = ticket.rebate ?? 0;
  els.targetTotal.value = ticket.deliveryTarget ?? 0;
  els.targetAllocated.value = ticket.allocated ?? 0;
  els.targetGap.value = ticket.gap ?? 0;
  els.oddsFinal.value = Number(ticket.finalOdds || 0).toFixed(2);
  els.recOdds.value = Number(ticket.finalOdds || 0).toFixed(2);

  els.sourceArrivedAt.textContent = ticket.sourceMessage?.arrivedAt
    ? `${ticket.sourceMessage.arrivedAt} 收到下发`
    : "等待通道消息";
  els.sourceMessageText.innerHTML = textToHtml(ticket.sourceMessage?.text || "尚未收到新消息");

  calculateLocal();

  const sourceFingerprint = `${ticket.sourceChannelId || ""}|${ticket.sourceMessage?.arrivedAt || ""}|${ticket.sourceMessage?.text || ""}`;
  if (ticket.sourceMessage?.text && sourceFingerprint !== previousFingerprint) {
    state.lastSourceFingerprint = sourceFingerprint;
    void extractSourceMessageToConsole({ toast: false });
  } else {
    state.lastSourceFingerprint = sourceFingerprint;
  }
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
      status.connection === "connecting" ? "登录窗口已启动，二维码会在网页或弹出的 Chrome 中出现" : "点击“取二维码”后在此显示";
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
  updateReceiptText();
}

function buildSummaryText() {
  const ticket = currentTicketPatch();
  const resources = Array.from(document.querySelectorAll(".rc-row")).map((row) => ({
    name: row.querySelector(".resource-name")?.value || "",
    enabled: row.querySelector(".resource-send")?.checked,
    amount: Number(row.querySelector(".resource-amount")?.value || 0),
    remoteId: row.querySelector(".resource-bind")?.value || ""
  }));

  const enabledResources = resources.filter((item) => item.enabled);
  const total = enabledResources.reduce((sum, item) => sum + item.amount, 0);

  return [
    `单号: ${state.snapshot?.currentTicket?.id || "--"}`,
    `品类: ${ticket.league}`,
    `品牌: ${ticket.teams}`,
    `报价: ${ticket.marketText}`,
    `回执水位: ${els.oddsFinal.value}`,
    `总目标: ${ticket.deliveryTarget}`,
    `已分配: ${total}`,
    "分销商明细:",
    ...enabledResources.map((item) => `- ${item.name} | ${item.amount}U | ${item.remoteId || "未绑定"}`)
  ].join("\n");
}

async function copyText(text, successText) {
  await navigator.clipboard.writeText(text);
  notify(successText, "blue", true);
}

function bindCoreInputs() {
  [els.inpLeague, els.inpTeam, els.inpMarket, els.oddsRaw, els.oddsRebate, els.targetTotal].forEach((element) => {
    element.addEventListener("input", () => {
      calculateLocal();
      syncTicket();
    });
  });

  [els.recTarget, els.recAmt, els.recCount].forEach((element) => {
    element.addEventListener("input", updateReceiptText);
    element.addEventListener("change", updateReceiptText);
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

  document.querySelectorAll("[data-broadcast-action]").forEach((card) => {
    card.addEventListener("click", async () => {
      try {
        const action = card.dataset.broadcastAction;
        await api(`/api/actions/broadcast-${action}`, { method: "POST" });
        notify(`已发送${action === "prep" ? "预备报价单" : "报价"}`, "blue", true);
      } catch (error) {
        notify(error.message, "red", true);
      }
    });
  });

  document.querySelectorAll("[data-broadcast-custom]").forEach((card) => {
    card.addEventListener("click", async () => {
      try {
        await api("/api/actions/broadcast-custom", {
          method: "POST",
          body: { text: card.dataset.broadcastCustom }
        });
        notify(`已广播: ${card.dataset.broadcastCustom}`, "blue", true);
      } catch (error) {
        notify(error.message, "red", true);
      }
    });
  });
}

function bindResourceEvents() {
  els.resourceContainer.addEventListener("change", (event) => {
    const row = event.target.closest(".rc-row");
    if (!row) return;

    const resourceId = row.dataset.resourceId;
    if (event.target.matches(".resource-send")) {
      const amountInput = row.querySelector(".resource-amount");
      const disabled = !event.target.checked;
      row.classList.toggle("disabled", disabled);
      amountInput.disabled = disabled;
    }

    scheduleResourceSync(resourceId, {
      name: row.querySelector(".resource-name").value.trim(),
      remoteId: row.querySelector(".resource-bind").value.trim(),
      sendEnabled: row.querySelector(".resource-send").checked,
      canAmericas: row.querySelector(".resource-americas").checked,
      amount: Number(row.querySelector(".resource-amount").value || 0),
      slipCount: Number(row.querySelector(".resource-slip").value || 0),
      allocationType: row.querySelector(".resource-type").value
    });
    calculateLocal();
  });

  els.resourceContainer.addEventListener("input", (event) => {
    const row = event.target.closest(".rc-row");
    if (!row) return;

    const resourceId = row.dataset.resourceId;
    scheduleResourceSync(resourceId, {
      name: row.querySelector(".resource-name").value.trim(),
      remoteId: row.querySelector(".resource-bind").value.trim(),
      sendEnabled: row.querySelector(".resource-send").checked,
      canAmericas: row.querySelector(".resource-americas").checked,
      amount: Number(row.querySelector(".resource-amount").value || 0),
      slipCount: Number(row.querySelector(".resource-slip").value || 0),
      allocationType: row.querySelector(".resource-type").value
    });
    calculateLocal();
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

function bindDiscoveryEvents() {
  els.bindPlatformSelect.addEventListener("change", renderRecentChats);

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
      notify(`已绑定为${els.bindRoleSelect.value === "supplier" ? "供应商" : "分销商"}`, "blue", true);
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

  els.alertActionBtn.addEventListener("click", async () => {
    const priceMatch = els.alertText.textContent.match(/(\d+\.\d+)/);
    if (!priceMatch) {
      notify("当前没有可回传的掉水价格", "red", true);
      return;
    }

    try {
      await api("/api/actions/source-reply", {
        method: "POST",
        body: { text: priceMatch[1] }
      });
      notify(`已反馈供应商 ${priceMatch[1]}`, "blue", true);
    } catch (error) {
      notify(error.message, "red", true);
    }
  });
}

async function init() {
  renderQuickReplies();
  bindCoreInputs();
  bindResourceEvents();
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
