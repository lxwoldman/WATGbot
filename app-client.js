const state = {
  snapshot: null,
  selectedSourceId: null,
  selectedReceiptResourceId: null,
  resourceSyncTimers: {},
  selectedBindingTarget: "",
  discovery: {
    itemsByPlatform: {
      whatsapp: [],
      telegram: []
    }
  },
  integration: {
    whatsapp: null,
    telegram: null
  }
};

const socket = io();

const els = {
  sourceOnlineBadge: document.getElementById("sourceOnlineBadge"),
  sourceChannelSelect: document.getElementById("sourceChannelSelect"),
  sourceArrivedAt: document.getElementById("sourceArrivedAt"),
  sourceMessageText: document.getElementById("sourceMessageText"),
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
  bindTargetSelect: document.getElementById("bindTargetSelect"),
  bindPlatformSelect: document.getElementById("bindPlatformSelect"),
  bindRefreshBtn: document.getElementById("bindRefreshBtn"),
  bindApplyBtn: document.getElementById("bindApplyBtn"),
  bindDiscoverySelect: document.getElementById("bindDiscoverySelect"),
  bindRemoteIdInput: document.getElementById("bindRemoteIdInput"),
  bindMetaText: document.getElementById("bindMetaText"),
  copyMarketBtn: document.getElementById("copyMarketBtn"),
  buildSummaryBtn: document.getElementById("buildSummaryBtn")
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

function setBadge(element, text, tone = "") {
  if (!element) return;
  element.textContent = text;
  element.className = `badge${tone ? ` ${tone}` : ""}`;
}

function setInputValue(element, value) {
  if (!element) return;
  if (document.activeElement === element) return;
  element.value = value ?? "";
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

function setOpsStatus(text, tone = "") {
  setBadge(els.opsGlobalBadge, text, tone);
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

function getResourceById(resourceId) {
  return state.snapshot?.resources?.find((item) => item.id === resourceId) || null;
}

function getSourceChannelById(sourceChannelId) {
  return state.snapshot?.sourceChannels?.find((item) => item.id === sourceChannelId) || null;
}

function getBindingTargetMeta(targetValue) {
  if (!targetValue) return null;
  const [targetType, targetId] = targetValue.split(":", 2);
  if (targetType === "source") {
    const source = getSourceChannelById(targetId);
    if (!source) return null;
    return {
      targetType,
      targetId,
      platform: source.type,
      label: source.label,
      remoteId: source.remoteId || ""
    };
  }

  if (targetType === "resource") {
    const resource = getResourceById(targetId);
    if (!resource) return null;
    return {
      targetType,
      targetId,
      platform: resource.platform,
      label: resource.name,
      remoteId: resource.remoteId || ""
    };
  }

  return null;
}

function formatDiscoveryOption(item) {
  const title = item.title || item.label || item.remoteId || "未命名会话";
  const suffix = item.remoteId ? ` | ${item.remoteId}` : "";
  const type = item.type ? ` [${item.type}]` : "";
  return `${title}${type}${suffix}`;
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
    `联赛: ${ticket.league}`,
    `对阵: ${ticket.teams}`,
    `盘口: ${ticket.marketText}`,
    `回执水位: ${els.oddsFinal.value}`,
    `总目标: ${ticket.deliveryTarget}`,
    `已分配: ${total}`,
    "资源明细:",
    ...enabledResources.map((item) => `- ${item.name} | ${item.amount}U | ${item.remoteId || "未绑定"}`)
  ].join("\n");
}

async function copyText(text, successText) {
  await navigator.clipboard.writeText(text);
  setOpsStatus(successText, "blue");
}

function renderSourceChannels(snapshot) {
  const channels = snapshot.sourceChannels || [];
  const fallbackId = snapshot.currentTicket?.sourceChannelId || channels[0]?.id || "";
  if (!channels.some((item) => item.id === state.selectedSourceId)) {
    state.selectedSourceId = fallbackId;
  }

  const currentValue = els.sourceChannelSelect.value;
  const optionHtml = channels
    .map((channel) => `<option value="${channel.id}">${escapeHtml(channel.label)}</option>`)
    .join("");
  if (els.sourceChannelSelect.innerHTML !== optionHtml) {
    els.sourceChannelSelect.innerHTML = optionHtml || "<option value=''>暂无通道</option>";
  }
  if (currentValue !== state.selectedSourceId) {
    els.sourceChannelSelect.value = state.selectedSourceId;
  }

  const selected = channels.find((item) => item.id === state.selectedSourceId) || channels[0];
  setBadge(
    els.sourceOnlineBadge,
    selected?.online ? "在线" : "离线",
    selected?.online ? "blue" : "red"
  );
}

function renderBindingTargets(snapshot) {
  const sourceOptions = (snapshot.sourceChannels || []).map(
    (channel) =>
      `<option value="source:${channel.id}">[源头] ${escapeHtml(channel.label)}${
        channel.remoteId ? ` · ${escapeHtml(channel.remoteId)}` : " · 未绑定"
      }</option>`
  );
  const resourceOptions = (snapshot.resources || []).map(
    (resource) =>
      `<option value="resource:${resource.id}">[资源] ${escapeHtml(resource.name)}${
        resource.remoteId ? ` · ${escapeHtml(resource.remoteId)}` : " · 未绑定"
      }</option>`
  );
  const optionHtml = [...sourceOptions, ...resourceOptions].join("");
  if (els.bindTargetSelect.innerHTML !== optionHtml) {
    els.bindTargetSelect.innerHTML = optionHtml || "<option value=''>暂无可绑定对象</option>";
  }

  if (!getBindingTargetMeta(state.selectedBindingTarget)) {
    const fallbackSourceId = snapshot.currentTicket?.sourceChannelId || snapshot.sourceChannels?.[0]?.id || "";
    const fallbackResourceId = snapshot.resources?.[0]?.id || "";
    const fallbackTarget =
      (fallbackSourceId && `source:${fallbackSourceId}`) ||
      (fallbackResourceId && `resource:${fallbackResourceId}`) ||
      "";
    state.selectedBindingTarget = typeof fallbackTarget === "string" ? fallbackTarget : "";
  }

  if (state.selectedBindingTarget) {
    els.bindTargetSelect.value = state.selectedBindingTarget;
  }

  syncBindingTargetUI();
}

function renderDiscoveryItems(platform) {
  const items = state.discovery.itemsByPlatform[platform] || [];
  const optionHtml = items
    .map((item) => `<option value="${escapeHtml(item.remoteId)}">${escapeHtml(formatDiscoveryOption(item))}</option>`)
    .join("");
  els.bindDiscoverySelect.innerHTML = optionHtml || "<option value=''>暂无已发现会话</option>";

  const targetMeta = getBindingTargetMeta(state.selectedBindingTarget);
  const currentRemoteId = els.bindRemoteIdInput.value.trim() || targetMeta?.remoteId || "";
  const matched = items.find((item) => item.remoteId === currentRemoteId);
  if (matched) {
    els.bindDiscoverySelect.value = matched.remoteId;
  } else if (items[0]?.remoteId) {
    els.bindDiscoverySelect.value = items[0].remoteId;
  }

  const selectedItem = items.find((item) => item.remoteId === els.bindDiscoverySelect.value) || null;
  if (!document.activeElement || document.activeElement !== els.bindRemoteIdInput) {
    els.bindRemoteIdInput.value = selectedItem?.remoteId || currentRemoteId;
  }

  els.bindMetaText.textContent = selectedItem
    ? [
        `目标: ${targetMeta?.label || "--"}`,
        `会话: ${selectedItem.title || selectedItem.label || selectedItem.remoteId}`,
        selectedItem.lastMessageAt
          ? `最近活动: ${new Date(selectedItem.lastMessageAt).toLocaleString("zh-CN", { hour12: false })}`
          : "最近活动: 未知"
      ].join(" | ")
    : `目标: ${targetMeta?.label || "--"} | 当前平台: ${platform} | 暂无已发现会话`;
}

function syncBindingTargetUI() {
  const targetMeta = getBindingTargetMeta(state.selectedBindingTarget);
  if (!targetMeta) {
    els.bindMetaText.textContent = "先选择目标，再拉取最近会话。";
    return;
  }

  els.bindPlatformSelect.value = targetMeta.platform || els.bindPlatformSelect.value;
  els.bindRemoteIdInput.value = targetMeta.remoteId || "";
  setBadge(
    els.bindScopeBadge,
    targetMeta.targetType === "source" ? "源头绑定" : "资源绑定",
    "blue"
  );
  renderDiscoveryItems(els.bindPlatformSelect.value);
}

function renderResources(resources) {
  const html = resources
    .map((resource) => {
      const disabled = !resource.sendEnabled;
      return `
        <div class="rc-row${disabled ? " disabled" : ""}" data-resource-id="${resource.id}">
          <div class="rc-id">
            <input class="name resource-name" value="${escapeHtml(resource.name || "")}">
            <input class="bind resource-bind" value="${escapeHtml(resource.remoteId || "")}" placeholder="${escapeHtml(resource.bindingLabel || "remoteId / jid")}" title="${escapeHtml(resource.bindingLabel || "")}">
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
          </div>
        </div>
      `;
    })
    .join("");

  els.resourceContainer.innerHTML = html;

  const options = resources
    .map((resource) => `<option value="${resource.id}">${resource.name}</option>`)
    .join("");
  els.recTarget.innerHTML = options;

  if (!resources.some((item) => item.id === state.selectedReceiptResourceId)) {
    state.selectedReceiptResourceId = resources[0]?.id || "";
  }
  if (state.selectedReceiptResourceId) {
    els.recTarget.value = state.selectedReceiptResourceId;
    loadReceiptResource(state.selectedReceiptResourceId);
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

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  renderSourceChannels(snapshot);
  renderBindingTargets(snapshot);

  const ticket = snapshot.currentTicket || {};
  setBadge(els.ticketIdBadge, `单号 ${ticket.id || "--"}`);
  setInputValue(els.inpLeague, ticket.league || "");
  setInputValue(els.inpTeam, ticket.teams || "");
  setInputValue(els.inpMarket, ticket.marketText || "");
  setInputValue(els.oddsRaw, ticket.rawOdds ?? 0);
  setInputValue(els.oddsRebate, ticket.rebate ?? 0);
  setInputValue(els.targetTotal, ticket.deliveryTarget ?? 0);
  setInputValue(els.targetAllocated, ticket.allocated ?? 0);
  setInputValue(els.targetGap, ticket.gap ?? 0);
  setInputValue(els.oddsFinal, Number(ticket.finalOdds || 0).toFixed(2));
  setInputValue(els.recOdds, Number(ticket.finalOdds || 0).toFixed(2));

  els.sourceArrivedAt.textContent = ticket.sourceMessage?.arrivedAt
    ? `${ticket.sourceMessage.arrivedAt} 收到下发`
    : "等待通道消息";
  els.sourceMessageText.innerHTML = textToHtml(ticket.sourceMessage?.text || "尚未收到新消息");

  renderResources(snapshot.resources || []);
  renderAlert(snapshot);
  calculateLocal();
}

function renderWhatsAppStatus(status) {
  state.integration.whatsapp = status;
  let tone = "";
  if (status.connection === "open") tone = "blue";
  else if (status.lastError) tone = "red";
  setBadge(els.waStatusBadge, status.status || "待登录", tone);

  if (status.qrDataUrl) {
    els.waQrImage.src = status.qrDataUrl;
    els.waQrImage.hidden = false;
    els.waQrHint.hidden = true;
  } else {
    els.waQrImage.hidden = true;
    els.waQrHint.hidden = false;
    els.waQrHint.textContent = status.connection === "connecting" ? "正在等待二维码..." : "点击“取二维码”后在此显示";
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
  let tone = "";
  if (status.authorized) tone = "blue";
  else if (status.lastError) tone = "red";
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

async function refreshDiscovery(platform = els.bindPlatformSelect.value) {
  const endpoint =
    platform === "telegram"
      ? "/api/integrations/telegram-userbot/dialogs?limit=80"
      : "/api/integrations/whatsapp/chats?limit=80";

  const items = await api(endpoint);
  state.discovery.itemsByPlatform[platform] = items;
  renderDiscoveryItems(platform);
  return items;
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
    setOpsStatus(error.message, "red");
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
    setOpsStatus("已同步交易单", "blue");
  } catch (error) {
    setOpsStatus(error.message, "red");
  }
}, 300);

function scheduleResourceSync(resourceId, patch) {
  clearTimeout(state.resourceSyncTimers[resourceId]);
  state.resourceSyncTimers[resourceId] = setTimeout(async () => {
    try {
      await postResourcePatch(resourceId, patch);
      setOpsStatus("已同步资源配置", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  }, 300);
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

  document.querySelectorAll("[data-source-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/actions/source-reply", {
          method: "POST",
          body: { text: button.dataset.sourceReply }
        });
        setOpsStatus(`已回复源头: ${button.dataset.sourceReply}`, "blue");
      } catch (error) {
        setOpsStatus(error.message, "red");
      }
    });
  });

  document.querySelectorAll("[data-broadcast-action]").forEach((card) => {
    card.addEventListener("click", async () => {
      try {
        const action = card.dataset.broadcastAction;
        await api(`/api/actions/broadcast-${action}`, { method: "POST" });
        setOpsStatus(`已广播: ${action}`, "blue");
      } catch (error) {
        setOpsStatus(error.message, "red");
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
        setOpsStatus(`已广播: ${card.dataset.broadcastCustom}`, "blue");
      } catch (error) {
        setOpsStatus(error.message, "red");
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

    try {
      await api(`/api/actions/resources/${resourceId}/${action}`, { method: "POST" });
      setOpsStatus(`已发送资源${action}`, "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
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
      setOpsStatus("已请求 WhatsApp 二维码", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
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
      setOpsStatus("已请求 WhatsApp 配对码", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.waReconnectBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/reconnect", { method: "POST" });
      await refreshIntegrationStatuses();
      setOpsStatus("已触发 WhatsApp 重连", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.waLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/whatsapp/logout", { method: "POST" });
      await refreshIntegrationStatuses();
      setOpsStatus("WhatsApp 已登出", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
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
      setOpsStatus("已请求 Telegram 验证码", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
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
      setOpsStatus("Telegram 登录流程已提交", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.tgLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/integrations/telegram-userbot/logout", { method: "POST" });
      await refreshIntegrationStatuses();
      setOpsStatus("Telegram 已登出", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });
}

function bindBindingEvents() {
  els.bindTargetSelect.addEventListener("change", async () => {
    state.selectedBindingTarget = els.bindTargetSelect.value;
    syncBindingTargetUI();

    const targetMeta = getBindingTargetMeta(state.selectedBindingTarget);
    if (!targetMeta) return;

    try {
      if (!state.discovery.itemsByPlatform[targetMeta.platform]?.length) {
        await refreshDiscovery(targetMeta.platform);
      }
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.bindPlatformSelect.addEventListener("change", async () => {
    const platform = els.bindPlatformSelect.value;
    renderDiscoveryItems(platform);
    try {
      if (!state.discovery.itemsByPlatform[platform]?.length) {
        await refreshDiscovery(platform);
      }
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.bindDiscoverySelect.addEventListener("change", () => {
    const platform = els.bindPlatformSelect.value;
    const items = state.discovery.itemsByPlatform[platform] || [];
    const selectedItem = items.find((item) => item.remoteId === els.bindDiscoverySelect.value) || null;
    if (selectedItem) {
      els.bindRemoteIdInput.value = selectedItem.remoteId;
    }
    renderDiscoveryItems(platform);
  });

  els.bindRemoteIdInput.addEventListener("input", () => {
    const platform = els.bindPlatformSelect.value;
    const items = state.discovery.itemsByPlatform[platform] || [];
    const selectedItem = items.find((item) => item.remoteId === els.bindRemoteIdInput.value.trim()) || null;
    if (selectedItem) {
      els.bindDiscoverySelect.value = selectedItem.remoteId;
    }
    renderDiscoveryItems(platform);
  });

  els.bindRefreshBtn.addEventListener("click", async () => {
    try {
      const items = await refreshDiscovery(els.bindPlatformSelect.value);
      setOpsStatus(`已拉取 ${items.length} 个最近会话`, "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.bindApplyBtn.addEventListener("click", async () => {
    const targetMeta = getBindingTargetMeta(state.selectedBindingTarget);
    const remoteId = els.bindRemoteIdInput.value.trim();
    if (!targetMeta) {
      setOpsStatus("请先选择绑定目标", "red");
      return;
    }
    if (!remoteId) {
      setOpsStatus("请先选择或填写 remoteId", "red");
      return;
    }

    const platform = els.bindPlatformSelect.value;
    const selectedItem =
      (state.discovery.itemsByPlatform[platform] || []).find((item) => item.remoteId === remoteId) || null;

    try {
      if (targetMeta.targetType === "source") {
        await api(`/api/source-channels/${targetMeta.targetId}`, {
          method: "PATCH",
          body: { remoteId }
        });
      } else {
        await api(`/api/resources/${targetMeta.targetId}`, {
          method: "PATCH",
          body: {
            remoteId,
            ...(selectedItem?.title ? { bindingLabel: selectedItem.title } : {})
          }
        });
      }

      setOpsStatus(`已保存绑定: ${remoteId}`, "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
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
      setOpsStatus(error.message, "red");
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
      setOpsStatus("回执已发送", "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.copyMarketBtn.addEventListener("click", async () => {
    try {
      await copyText(els.inpMarket.value, "盘口已复制");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.buildSummaryBtn.addEventListener("click", async () => {
    try {
      await copyText(buildSummaryText(), "汇总已复制");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });

  els.alertActionBtn.addEventListener("click", async () => {
    const priceMatch = els.alertText.textContent.match(/(\d+\.\d+)/);
    if (!priceMatch) {
      setOpsStatus("当前没有可回传的掉水价格", "red");
      return;
    }

    try {
      await api("/api/actions/source-reply", {
        method: "POST",
        body: { text: priceMatch[1] }
      });
      setOpsStatus(`已反馈源头 ${priceMatch[1]}`, "blue");
    } catch (error) {
      setOpsStatus(error.message, "red");
    }
  });
}

async function init() {
  bindCoreInputs();
  bindResourceEvents();
  bindIntegrationEvents();
  bindBindingEvents();
  bindReceiptEvents();

  socket.on("bootstrap", renderSnapshot);
  socket.on("snapshot", renderSnapshot);
  socket.on("connect", () => setOpsStatus("Socket 已连接", "blue"));
  socket.on("disconnect", () => setOpsStatus("Socket 已断开", "red"));

  try {
    const snapshot = await api("/api/bootstrap");
    renderSnapshot(snapshot);
    await refreshIntegrationStatuses();
    await refreshDiscovery("whatsapp").catch(() => []);
  } catch (error) {
    setOpsStatus(error.message, "red");
  }

  setInterval(refreshIntegrationStatuses, 5000);
}

init();
